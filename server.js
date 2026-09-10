require("dotenv").config();
const path=require("path");
const fs=require("fs");
const express=require("express");
const helmet=require("helmet");
const rateLimit=require("express-rate-limit");
const session=require("express-session");
const bcrypt=require("bcryptjs");
const Database=require("better-sqlite3");
const compression=require("compression");
const multer=require("multer");

const app=express();
const PORT=Number(process.env.PORT||3000);
const DATA_DIR=path.join(__dirname,"data");
const UPLOAD_DIR=path.join(DATA_DIR,"uploads"); // persistent volume — survives restarts
fs.mkdirSync(DATA_DIR,{recursive:true}); fs.mkdirSync(UPLOAD_DIR,{recursive:true});

const db=new Database(path.join(DATA_DIR,"cookies.db"));
db.pragma("journal_mode = WAL");
db.exec(`
CREATE TABLE IF NOT EXISTS categories(
 id TEXT PRIMARY KEY, name TEXT NOT NULL, image TEXT NOT NULL DEFAULT '/images/placeholder.svg', note TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS items(
 id TEXT PRIMARY KEY, category_id TEXT NOT NULL, name TEXT NOT NULL, description TEXT DEFAULT '',
 price TEXT NOT NULL, price_caption TEXT DEFAULT '', image TEXT NOT NULL DEFAULT '/images/placeholder.svg',
 available INTEGER NOT NULL DEFAULT 1,
 FOREIGN KEY(category_id) REFERENCES categories(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS orders(
 id INTEGER PRIMARY KEY AUTOINCREMENT, customer_name TEXT NOT NULL, phone TEXT NOT NULL,
 order_type TEXT NOT NULL, table_number TEXT DEFAULT '', address TEXT DEFAULT '', notes TEXT DEFAULT '',
 items_json TEXT NOT NULL, total REAL NOT NULL, status TEXT NOT NULL DEFAULT 'NEW',
 created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS admin_users(username TEXT PRIMARY KEY,password_hash TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(sid TEXT PRIMARY KEY, sess TEXT NOT NULL, expired INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS table_sessions(
  table_number TEXT PRIMARY KEY,
  is_active INTEGER NOT NULL DEFAULT 0,
  session_token TEXT DEFAULT '',
  passcode TEXT DEFAULT '',
  opened_at TEXT DEFAULT '',
  closed_at TEXT DEFAULT ''
);
`);
try{ db.exec("ALTER TABLE orders ADD COLUMN table_number TEXT DEFAULT ''"); }catch(e){}
try{ db.exec("ALTER TABLE orders ADD COLUMN session_token TEXT DEFAULT ''"); }catch(e){}
try{ db.exec("ALTER TABLE table_sessions ADD COLUMN passcode TEXT DEFAULT ''"); }catch(e){}

const tblCount = db.prepare("SELECT COUNT(*) c FROM table_sessions").get().c;
if(!tblCount){
  const ins = db.prepare("INSERT INTO table_sessions(table_number, is_active, session_token, passcode) VALUES(?, 0, '', '')");
  for(let i=1; i<=15; i++) ins.run(String(i));
}

const seed=JSON.parse(fs.readFileSync(path.join(__dirname,"menu.json"),"utf8"));
const catCount=db.prepare("SELECT COUNT(*) c FROM categories").get().c;
if(!catCount){
 const ic=db.transaction(()=>{
   const ci=db.prepare("INSERT INTO categories(id,name,image,note) VALUES(?,?,?,?)");
   const ii=db.prepare("INSERT INTO items(id,category_id,name,description,price,price_caption,image,available) VALUES(?,?,?,?,?,?,?,?)");
   for(const c of seed.categories){
     ci.run(c.id,c.name,c.image,c.note||"");
     for(const x of c.items) ii.run(x.id,c.id,x.name,x.description,x.price,x.priceCaption||"",x.image,1);
   }
 });
 ic();
}
const DEFAULT_ADMIN_HASH = "$2b$12$noMLJqG//LyjhKmYeKun4uklH3i/gEOtH6ChQjK2KY2cINeZiKPTW"; // CookieAdmin2025!
const adminUser = clean(process.env.ADMIN_USERNAME || "admin", 80);
const adminHash = process.env.ADMIN_PASSWORD_HASH || DEFAULT_ADMIN_HASH;

try {
  db.prepare("INSERT INTO admin_users(username, password_hash) VALUES(?, ?) ON CONFLICT(username) DO UPDATE SET password_hash=?")
    .run(adminUser, adminHash, adminHash);
} catch(e) {
  console.error("Admin user sync error:", e.message);
}

app.disable("x-powered-by");
app.set("trust proxy", 1); // Railway sits behind HTTPS proxy
app.use(helmet({contentSecurityPolicy:false,crossOriginResourcePolicy:{policy:"cross-origin"}}));
app.use(compression());
app.use(express.json({limit:"200kb"}));
app.use(express.urlencoded({extended:true,limit:"100kb"}));

const authLimiter=rateLimit({windowMs:15*60*1000,max:100,standardHeaders:true,legacyHeaders:false});
const orderLimiter=rateLimit({windowMs:10*60*1000,max:50,standardHeaders:true,legacyHeaders:false});

// Persistent SQLite session store — survives server restarts
class SqliteStore extends session.Store {
 get(sid,cb){
  try{
   const row=db.prepare("SELECT sess,expired FROM sessions WHERE sid=?").get(sid);
   if(!row) return cb(null,null);
   if(Date.now()>row.expired){db.prepare("DELETE FROM sessions WHERE sid=?").run(sid);return cb(null,null);}
   cb(null,JSON.parse(row.sess));
  }catch(e){cb(e);}
 }
 set(sid,sess,cb){
  try{
   const exp=sess.cookie?.expires?new Date(sess.cookie.expires).getTime():Date.now()+8*60*60*1000;
   db.prepare("INSERT OR REPLACE INTO sessions(sid,sess,expired) VALUES(?,?,?)").run(sid,JSON.stringify(sess),exp);
   cb(null);
  }catch(e){cb(e);}
 }
 destroy(sid,cb){
  try{db.prepare("DELETE FROM sessions WHERE sid=?").run(sid);cb(null);}catch(e){cb(e);}
 }
}

app.use(session({
 secret:process.env.SESSION_SECRET||"CHANGE_ME",
 resave:false,saveUninitialized:false,
 store:new SqliteStore(),
 cookie:{httpOnly:true,sameSite:"lax",secure:false,maxAge:8*60*60*1000}
}));

const storage=multer.diskStorage({
 destination:(_,__,cb)=>cb(null,UPLOAD_DIR),
 filename:(_,file,cb)=>{
   const ext=path.extname(file.originalname).toLowerCase().replace(/[^a-z0-9.]/g,"");
   cb(null,Date.now()+"-"+Math.random().toString(36).slice(2,10)+ext);
 }
});
const upload=multer({
 storage,
 limits:{fileSize:5*1024*1024},
 fileFilter:(_,file,cb)=>cb(null,/^image\/(jpeg|png|webp|gif|svg\+xml)$/.test(file.mimetype))
});

app.get("/api/version",(req,res)=>res.json({version:"v3-session-fix",cookieSecure:false,trustProxy:true,hasSession:!!req.session,hasAdmin:!!req.session.admin}));

function auth(req,res,next){ if(req.session.admin) return next(); res.status(401).json({error:"Unauthorized"}); }
function clean(v,max=500){return String(v??"").trim().slice(0,max)}
function priceNumber(v){
 const m=String(v).replace(/,/g,"").match(/\d+(?:\.\d+)?/);
 return m?Number(m[0]):0;
}

app.get("/api/menu",(req,res)=>{
 const cats=db.prepare("SELECT * FROM categories ORDER BY rowid").all();
 for(const c of cats)c.items=db.prepare("SELECT * FROM items WHERE category_id=? ORDER BY rowid").all(c.id).map(x=>({...x,available:!!x.available}));
 res.json({categories:cats});
});

app.post("/api/login",authLimiter,async(req,res)=>{
 const u=clean(req.body.username,80).trim();
 const p=String(req.body.password||"").trim();
 const row=db.prepare("SELECT * FROM admin_users WHERE username=?").get(u);
 if(!row || !(await bcrypt.compare(p,row.password_hash))){
   return res.status(401).json({error:"Invalid username or password"});
 }
 req.session.admin={username:u};
 req.session.save(err=>{
   if(err) return res.status(500).json({error:"Failed to initialize session"});
   res.json({ok:true});
 });
});
app.post("/api/logout",auth,(req,res)=>req.session.destroy(()=>res.json({ok:true})));
app.get("/api/me",(req,res)=>res.json({admin:!!req.session.admin,username:req.session.admin?.username||null}));

app.get("/api/orders",auth,(req,res)=>{
 const rows=db.prepare("SELECT * FROM orders ORDER BY id DESC LIMIT 1000").all();
 res.json(rows.map(o=>({...o,items:JSON.parse(o.items_json)})));
});
app.patch("/api/orders/:id",auth,(req,res)=>{
 const status=clean(req.body.status,30);
 if(!["NEW","CONFIRMED","PREPARING","READY","COMPLETED","CANCELLED"].includes(status)) return res.status(400).json({error:"Invalid status"});
 db.prepare("UPDATE orders SET status=? WHERE id=?").run(status,Number(req.params.id));
 res.json({ok:true});
});
app.delete("/api/orders/:id",auth,(req,res)=>{
 const id=Number(req.params.id);
 if(!id) return res.status(400).json({error:"Invalid order ID"});
 db.prepare("DELETE FROM orders WHERE id=?").run(id);
 res.json({ok:true});
});

app.post("/api/orders",orderLimiter,(req,res)=>{
 let customer_name=clean(req.body.customer_name,100);
 let phone=clean(req.body.phone,40);
 const order_type=clean(req.body.order_type,30) || "Dine-in";
 const table_number=clean(req.body.table_number,50);
 const address=clean(req.body.address,300);
 const notes=clean(req.body.notes,500);
 let items;
 try{items=Array.isArray(req.body.items)?req.body.items:[]}catch{items=[]}

 if(!items.length) return res.status(400).json({error:"At least one item is required."});

 const isDineIn = order_type.toLowerCase().includes("dine");
 const isDelivery = order_type.toLowerCase().includes("delivery");
 const isTakeout = order_type.toLowerCase().includes("takeout");

 let session_token=clean(req.body.session_token,100);
 const passcode=clean(req.body.passcode,20);

 if(isDineIn){
   if(!table_number) return res.status(400).json({error:"Please enter your Table Number for Dine-in orders."});
   const tbl=db.prepare("SELECT * FROM table_sessions WHERE table_number=?").get(table_number);
   if(!tbl||!tbl.is_active){
     return res.status(400).json({error:`Table #${table_number} is currently CLOSED. Please ask staff to open your table session.`});
   }
   const tokenMatch=(session_token && tbl.session_token && session_token===tbl.session_token);
   const codeMatch=(passcode && tbl.passcode && passcode===tbl.passcode);
   if(!tokenMatch && !codeMatch){
     return res.status(400).json({error:`Dining session for Table #${table_number} has expired or is invalid. Please scan the active QR code or ask staff for table passcode.`});
   }
   if(!session_token && tbl.session_token) session_token=tbl.session_token;

   // Dine-in: name is not required (defaults to Table #X), phone is removed
   if(!customer_name){
     customer_name = `Table #${table_number}`;
   }
   phone = "";
 } else if(isTakeout){
   // Takeout: name is required (first name/nickname), phone is optional
   if(!customer_name){
     return res.status(400).json({error:"Please enter your Name (First name or Nickname) for Takeout."});
   }
 } else if(isDelivery){
   // Delivery: full name, phone number, and address are required
   if(!customer_name){
     return res.status(400).json({error:"Please enter your Full Name for Delivery."});
   }
   if(!phone){
     return res.status(400).json({error:"Please enter your Phone Number for Delivery."});
   }
   if(!address){
     return res.status(400).json({error:"Please enter your Delivery Address."});
   }
 } else {
   if(!customer_name) customer_name = "Guest";
 }

 const normalized=items.map(x=>({id:clean(x.id,100),name:clean(x.name,150),qty:Math.max(1,Math.min(99,Number(x.qty)||1)),price:priceNumber(x.price),image:clean(x.image,500)})).filter(x=>x.name&&x.price>0);
 if(!normalized.length)return res.status(400).json({error:"No valid items."});
 const total=normalized.reduce((a,x)=>a+x.qty*x.price,0);
 const created_at=new Date().toISOString();
 const info=db.prepare("INSERT INTO orders(customer_name,phone,order_type,table_number,session_token,address,notes,items_json,total,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)")
   .run(customer_name,phone,order_type,table_number,session_token,address,notes,JSON.stringify(normalized),total,created_at);
 const order={id:info.lastInsertRowid,customer_name,phone,order_type,table_number,session_token,address,notes,items:normalized,total,created_at};
 sendMessenger(order).catch(e=>console.error("Messenger:",e.message));
 res.json({ok:true,orderId:info.lastInsertRowid});
});

async function sendMessenger(order){
 const pageId=process.env.MESSENGER_PAGE_ID, token=process.env.MESSENGER_PAGE_ACCESS_TOKEN;
 if(!pageId||!token)return;
 const lines=order.items.map(i=>`• ${i.name} x${i.qty} = ₱${(i.qty*i.price).toFixed(2)}`).join("\n");
 const text=`🍪 NEW ORDER #${order.id}\nCustomer: ${order.customer_name}\n${order.phone?`Phone: ${order.phone}\n`:""}Type: ${order.order_type}\n${order.table_number?`Table: #${order.table_number}\n`:""}${order.address?`Address: ${order.address}\n`:""}\n${lines}\n\nTOTAL: ₱${order.total.toFixed(2)}${order.notes?`\nNotes: ${order.notes}`:""}`;
 const r=await fetch(`https://graph.facebook.com/v23.0/${encodeURIComponent(pageId)}/messages?access_token=${encodeURIComponent(token)}`,{
   method:"POST",headers:{"Content-Type":"application/json"},
   body:JSON.stringify({recipient:{id:pageId},message:{text}})
 });
 if(!r.ok) throw new Error(await r.text());
}

app.post("/api/admin/categories",auth,(req,res)=>{
 const rawId=req.body.id?clean(req.body.id,60):clean(req.body.name,60);
 const id=rawId.toLowerCase().replace(/[^a-z0-9-]/g,"-").replace(/-+/g,"-");
 const name=clean(req.body.name,100); const image=clean(req.body.image||"/images/placeholder.svg",500); const note=clean(req.body.note,500);
 if(!id||!name)return res.status(400).json({error:"Category name is required"});
 try{
  db.prepare("INSERT INTO categories(id,name,image,note) VALUES(?,?,?,?)").run(id,name,image,note);
  res.json({ok:true,id});
 }catch(err){
  res.status(400).json({error:err.message.includes("UNIQUE")?"Category ID already exists":err.message});
 }
});
app.patch("/api/admin/categories/:id",auth,(req,res)=>{
 const id=clean(req.params.id,60); const name=clean(req.body.name,100); const image=clean(req.body.image||"/images/placeholder.svg",500); const note=clean(req.body.note,500);
 db.prepare("UPDATE categories SET name=?,image=?,note=? WHERE id=?").run(name,image,note,id); res.json({ok:true});
});
app.delete("/api/admin/categories/:id",auth,(req,res)=>{
 db.prepare("DELETE FROM items WHERE category_id=?").run(req.params.id); db.prepare("DELETE FROM categories WHERE id=?").run(req.params.id); res.json({ok:true});
});

app.post("/api/admin/items",auth,(req,res)=>{
 const category_id=clean(req.body.category_id,60); const name=clean(req.body.name,150); const description=clean(req.body.description,1000);
 let price=clean(req.body.price,50); const cap=clean(req.body.price_caption,100); const image=clean(req.body.image||"/images/placeholder.svg",500);
 const available=req.body.available===false||req.body.available===0||req.body.available==="false"?0:1;
 if(!category_id||!name||!price)return res.status(400).json({error:"Category, name and price are required"});
 if(!/^[P₱]/.test(price)) price = "P" + price.replace(/[^0-9.]/g,"");
 const rawId=req.body.id?clean(req.body.id,100):(name.toLowerCase().replace(/[^a-z0-9]/g,"-").slice(0,40)+"-"+category_id+"-"+Date.now().toString(36));
 const id=rawId.toLowerCase().replace(/[^a-z0-9-]/g,"-").replace(/-+/g,"-");
 try{
  db.prepare("INSERT INTO items(id,category_id,name,description,price,price_caption,image,available) VALUES(?,?,?,?,?,?,?,?)").run(id,category_id,name,description,price,cap,image,available);
  res.json({ok:true,id});
 }catch(err){
  res.status(400).json({error:err.message.includes("UNIQUE")?"Item with this ID already exists":err.message});
 }
});
app.patch("/api/admin/items/:id",auth,(req,res)=>{
 const id=clean(req.params.id,100); const c=clean(req.body.category_id,60); const n=clean(req.body.name,150); const d=clean(req.body.description,1000);
 const p=clean(req.body.price,50); const cap=clean(req.body.price_caption,100); const image=clean(req.body.image||"/images/placeholder.svg",500); const available=req.body.available?1:0;
 db.prepare("UPDATE items SET category_id=?,name=?,description=?,price=?,price_caption=?,image=?,available=? WHERE id=?").run(c,n,d,p,cap,image,available,id);
 res.json({ok:true});
});
app.delete("/api/admin/items/:id",auth,(req,res)=>{db.prepare("DELETE FROM items WHERE id=?").run(req.params.id);res.json({ok:true});});

app.post("/api/admin/upload",auth,upload.single("image"),(req,res)=>{
 if(!req.file)return res.status(400).json({error:"No image uploaded"});
 res.json({ok:true,url:"/uploads/"+req.file.filename});
});

// Table Session Validation & Management
app.get("/api/tables/validate",(req,res)=>{
 const t=clean(req.query.table||req.query.t,50);
 const token=clean(req.query.token||req.query.s,100);
 if(!t) return res.json({ok:false,error:"No table specified"});
 const row=db.prepare("SELECT * FROM table_sessions WHERE table_number=?").get(t);
 if(!row) return res.json({ok:false,active:false,table:t,error:`Table #${t} not found.`});
 if(!row.is_active){
  return res.json({ok:false,active:false,table:t,error:`Table #${t} is currently CLOSED. Please ask staff to open your table.`});
 }
 const tokenMatches=Boolean(token && row.session_token && token===row.session_token);
 res.json({
  ok:true,
  active:true,
  table:t,
  tokenMatches,
  passcodeRequired:!tokenMatches,
  session_token:tokenMatches?row.session_token:"",
  opened_at:row.opened_at
 });
});

app.get("/api/admin/tables",auth,(req,res)=>{
 const rows=db.prepare("SELECT * FROM table_sessions ORDER BY CAST(table_number AS INTEGER), table_number").all();
 const orderCounts=db.prepare("SELECT table_number, COUNT(*) c FROM orders WHERE status NOT IN ('COMPLETED','CANCELLED') AND table_number != '' GROUP BY table_number").all();
 const map={};
 for(const oc of orderCounts) map[oc.table_number]=oc.c;
 res.json(rows.map(r=>({...r,active_orders:map[r.table_number]||0})));
});

app.post("/api/admin/tables/:table/open",auth,(req,res)=>{
 const t=clean(req.params.table,50);
 const passcode=Math.floor(1000+Math.random()*9000).toString();
 const token="ck-"+t+"-"+Date.now().toString(36)+"-"+Math.random().toString(36).slice(2,6);
 const now=new Date().toISOString();
 db.prepare("INSERT INTO table_sessions(table_number, is_active, session_token, passcode, opened_at) VALUES(?,1,?,?,?) ON CONFLICT(table_number) DO UPDATE SET is_active=1, session_token=?, passcode=?, opened_at=?")
   .run(t,token,passcode,now,token,passcode,now);
 res.json({ok:true,table:t,session_token:token,passcode});
});

app.post("/api/admin/tables/:table/close",auth,(req,res)=>{
 const t=clean(req.params.table,50);
 const now=new Date().toISOString();
 db.prepare("UPDATE table_sessions SET is_active=0, session_token='', passcode='', closed_at=? WHERE table_number=?").run(now,t);
 res.json({ok:true,table:t});
});

app.post("/api/admin/tables",auth,(req,res)=>{
 const t=clean(req.body.table_number,50);
 if(!t) return res.status(400).json({error:"Table number is required"});
 try{
  db.prepare("INSERT INTO table_sessions(table_number, is_active, session_token, passcode) VALUES(?,0,'','')").run(t);
  res.json({ok:true,table:t});
 }catch(e){
  res.status(400).json({error:"Table already exists"});
 }
});

app.delete("/api/admin/tables/:table",auth,(req,res)=>{
 const t=clean(req.params.table,50);
 db.prepare("DELETE FROM table_sessions WHERE table_number=?").run(t);
 res.json({ok:true});
});

app.use("/uploads", express.static(UPLOAD_DIR)); // serve persistent uploads
app.use(express.static(path.join(__dirname,"public"),{extensions:["html"]}));
app.get(/.*/, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT,()=>console.log(`Cookie's ordering system running at http://localhost:${PORT}`));

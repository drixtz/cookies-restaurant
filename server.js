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
const UPLOAD_DIR=path.join(__dirname,"public","uploads");
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
 order_type TEXT NOT NULL, address TEXT DEFAULT '', notes TEXT DEFAULT '',
 items_json TEXT NOT NULL, total REAL NOT NULL, status TEXT NOT NULL DEFAULT 'NEW',
 created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS admin_users(username TEXT PRIMARY KEY,password_hash TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(sid TEXT PRIMARY KEY, sess TEXT NOT NULL, expired INTEGER NOT NULL);
`);

const seed=JSON.parse(fs.readFileSync(path.join(DATA_DIR,"menu.json"),"utf8"));
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
if(!db.prepare("SELECT 1 FROM admin_users WHERE username=?").get(process.env.ADMIN_USERNAME||"admin")){
 const hash=process.env.ADMIN_PASSWORD_HASH;
 if(hash) db.prepare("INSERT INTO admin_users(username,password_hash) VALUES(?,?)").run(process.env.ADMIN_USERNAME||"admin",hash);
}

app.disable("x-powered-by");
app.set("trust proxy", 1); // Railway sits behind HTTPS proxy
app.use(helmet({contentSecurityPolicy:false,crossOriginResourcePolicy:{policy:"cross-origin"}}));
app.use(compression());
app.use(express.json({limit:"200kb"}));
app.use(express.urlencoded({extended:true,limit:"100kb"}));

const authLimiter=rateLimit({windowMs:15*60*1000,max:30,standardHeaders:true,legacyHeaders:false});
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
 const u=clean(req.body.username,80), p=String(req.body.password||"");
 const row=db.prepare("SELECT * FROM admin_users WHERE username=?").get(u);
 if(!row || !(await bcrypt.compare(p,row.password_hash))) return res.status(401).json({error:"Invalid username or password"});
 req.session.admin={username:u}; res.json({ok:true});
});
app.post("/api/logout",auth,(req,res)=>req.session.destroy(()=>res.json({ok:true})));
app.get("/api/me",(req,res)=>res.json({admin:!!req.session.admin,username:req.session.admin?.username||null}));

app.get("/api/orders",auth,(req,res)=>{
 const rows=db.prepare("SELECT * FROM orders ORDER BY id DESC LIMIT 300").all();
 res.json(rows.map(o=>({...o,items:JSON.parse(o.items_json)})));
});
app.patch("/api/orders/:id",auth,(req,res)=>{
 const status=clean(req.body.status,30);
 if(!["NEW","CONFIRMED","PREPARING","READY","COMPLETED","CANCELLED"].includes(status)) return res.status(400).json({error:"Invalid status"});
 db.prepare("UPDATE orders SET status=? WHERE id=?").run(status,Number(req.params.id));
 res.json({ok:true});
});

app.post("/api/orders",orderLimiter,(req,res)=>{
 const customer_name=clean(req.body.customer_name,100);
 const phone=clean(req.body.phone,40);
 const order_type=clean(req.body.order_type,30);
 const address=clean(req.body.address,300);
 const notes=clean(req.body.notes,500);
 let items;
 try{items=Array.isArray(req.body.items)?req.body.items:[]}catch{items=[]}
 if(!customer_name||!items.length) return res.status(400).json({error:"Name and at least one item are required."});
 const normalized=items.map(x=>({id:clean(x.id,100),name:clean(x.name,150),qty:Math.max(1,Math.min(99,Number(x.qty)||1)),price:priceNumber(x.price),image:clean(x.image,500)})).filter(x=>x.name&&x.price>0);
 if(!normalized.length)return res.status(400).json({error:"No valid items."});
 const total=normalized.reduce((a,x)=>a+x.qty*x.price,0);
 const created_at=new Date().toISOString();
 const info=db.prepare("INSERT INTO orders(customer_name,phone,order_type,address,notes,items_json,total,created_at) VALUES(?,?,?,?,?,?,?,?)")
   .run(customer_name,phone,order_type,address,notes,JSON.stringify(normalized),total,created_at);
 const order={id:info.lastInsertRowid,customer_name,phone,order_type,address,notes,items:normalized,total,created_at};
 sendMessenger(order).catch(e=>console.error("Messenger:",e.message));
 res.json({ok:true,orderId:info.lastInsertRowid});
});

async function sendMessenger(order){
 const pageId=process.env.MESSENGER_PAGE_ID, token=process.env.MESSENGER_PAGE_ACCESS_TOKEN;
 if(!pageId||!token)return;
 const lines=order.items.map(i=>`• ${i.name} x${i.qty} = ₱${(i.qty*i.price).toFixed(2)}`).join("\n");
 const text=`🍪 NEW ORDER #${order.id}\nCustomer: ${order.customer_name}\nPhone: ${order.phone}\nType: ${order.order_type}\n${order.address?`Address: ${order.address}\n`:""}\n${lines}\n\nTOTAL: ₱${order.total.toFixed(2)}${order.notes?`\nNotes: ${order.notes}`:""}`;
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

app.use(express.static(path.join(__dirname,"public"),{extensions:["html"]}));
app.get(/.*/, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT,()=>console.log(`Cookie's ordering system running at http://localhost:${PORT}`));

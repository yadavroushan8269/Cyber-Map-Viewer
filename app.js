import { initializeApp } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-app.js";
import {
  getAuth, signInAnonymously, onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/12.3.0/firebase-auth.js";
import {
  getFirestore, collection, doc, setDoc, getDoc, getDocs, query,
  where, addDoc, updateDoc, deleteDoc, serverTimestamp, orderBy
} from "https://www.gstatic.com/firebasejs/12.3.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const $ = id => document.getElementById(id);
let currentUser = null;
let profile = null;

function makeRoomId(){
  const chars="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s="";
  for(let i=0;i<8;i++) s+=chars[Math.floor(Math.random()*chars.length)];
  return s;
}

async function login(){
  const name=$("nameInput").value.trim();
  if(!name){$("authMsg").textContent="Enter your name.";return;}
  $("authMsg").textContent="Connecting...";
  try{
    await signInAnonymously(auth);
    sessionStorage.setItem("pendingName",name);
  }catch(e){$("authMsg").textContent=e.message;}
}

onAuthStateChanged(auth, async user=>{
  if(!user) return;
  currentUser=user;
  let ref=doc(db,"users",user.uid), snap=await getDoc(ref);
  if(!snap.exists()){
    let room=makeRoomId();
    let collision=await getDocs(query(collection(db,"users"),where("roomId","==",room)));
    while(!collision.empty){
      room=makeRoomId();
      collision=await getDocs(query(collection(db,"users"),where("roomId","==",room)));
    }
    profile={name:sessionStorage.getItem("pendingName")||"User",roomId:room,createdAt:serverTimestamp()};
    await setDoc(ref,profile);
  }else profile=snap.data();

  $("authView").hidden=true;
  $("appView").hidden=false;
  $("welcome").textContent="Hi, "+profile.name;
  $("roomId").textContent=profile.roomId;
  await refreshAll();
});

$("loginBtn").onclick=login;

$("logoutBtn").onclick=async()=>{
  await signOut(auth);
  location.reload();
};

$("copyRoomBtn").onclick=async()=>{
  await navigator.clipboard.writeText(profile.roomId);
  $("requestMsg").textContent="Room ID copied.";
};

$("sendRequestBtn").onclick=async()=>{
  const room=$("friendRoomInput").value.trim().toUpperCase();
  if(!room){$("requestMsg").textContent="Enter a Room ID.";return;}
  if(room===profile.roomId){$("requestMsg").textContent="You cannot add yourself.";return;}
  const q=await getDocs(query(collection(db,"users"),where("roomId","==",room)));
  if(q.empty){$("requestMsg").textContent="User not found.";return;}
  const target=q.docs[0];
  const existing=await getDocs(query(collection(db,"requests"),
    where("fromUid","==",currentUser.uid),where("toUid","==",target.id),where("status","==","pending")));
  if(!existing.empty){$("requestMsg").textContent="Request already sent.";return;}
  await addDoc(collection(db,"requests"),{
    fromUid:currentUser.uid,fromName:profile.name,fromRoomId:profile.roomId,
    toUid:target.id,status:"pending",createdAt:serverTimestamp()
  });
  $("requestMsg").textContent="Request sent.";
  $("friendRoomInput").value="";
};

async function renderRequests(){
  const q=await getDocs(query(collection(db,"requests"),where("toUid","==",currentUser.uid),where("status","==","pending")));
  $("requests").innerHTML="";
  if(q.empty){$("requests").innerHTML='<div class="empty">No pending requests.</div>';return;}
  q.forEach(d=>{
    const x=d.data(), el=document.createElement("div");
    el.className="item";
    el.innerHTML=`<b>${escapeHtml(x.fromName)}</b><br><small>Room ID: ${escapeHtml(x.fromRoomId)}</small>
      <div class="actions"><button data-accept="${d.id}">Accept</button><button class="secondary" data-reject="${d.id}">Reject</button></div>`;
    $("requests").appendChild(el);
  });
  document.querySelectorAll("[data-accept]").forEach(b=>b.onclick=()=>respond(b.dataset.accept,"accepted"));
  document.querySelectorAll("[data-reject]").forEach(b=>b.onclick=()=>respond(b.dataset.reject,"rejected"));
}

async function respond(id,status){
  const ref=doc(db,"requests",id), snap=await getDoc(ref);
  if(!snap.exists())return;
  const r=snap.data();
  await updateDoc(ref,{status});
  if(status==="accepted"){
    await setDoc(doc(db,"friendships",r.fromUid+"_"+currentUser.uid),{
      users:[r.fromUid,currentUser.uid],createdAt:serverTimestamp()
    });
  }
  await refreshAll();
}

async function renderFriends(){
  const q=await getDocs(query(collection(db,"friendships"),where("users","array-contains",currentUser.uid)));
  $("friends").innerHTML="";
  if(q.empty){$("friends").innerHTML='<div class="empty">No friends yet.</div>';return;}
  for(const d of q.docs){
    const ids=d.data().users, other=ids.find(x=>x!==currentUser.uid);
    const s=await getDoc(doc(db,"users",other));
    if(!s.exists())continue;
    const x=s.data(), el=document.createElement("div");
    el.className="item";
    el.innerHTML=`<b>${escapeHtml(x.name)}</b><br><small>Room ID: ${escapeHtml(x.roomId)}</small>
      <div class="actions"><button disabled>Video call</button><button class="secondary" disabled>Chat</button></div>`;
    $("friends").appendChild(el);
  }
}

$("postStoryBtn").onclick=async()=>{
  const text=$("storyText").value.trim();
  if(!text)return;
  await addDoc(collection(db,"stories"),{
    uid:currentUser.uid,name:profile.name,text,
    createdAt:serverTimestamp(),expiresAt:Date.now()+86400000
  });
  $("storyText").value="";
  await renderStories();
};

async function renderStories(){
  const now=Date.now();
  const q=await getDocs(query(collection(db,"stories"),where("uid","==",currentUser.uid)));
  $("stories").innerHTML="";
  q.forEach(async d=>{
    const x=d.data();
    if(x.expiresAt<=now){await deleteDoc(d.ref);return;}
    const el=document.createElement("div");el.className="item story";
    el.innerHTML=`<b>${escapeHtml(x.name)}</b><p>${escapeHtml(x.text)}</p><small>Expires in about ${Math.ceil((x.expiresAt-now)/3600000)}h</small>`;
    $("stories").appendChild(el);
  });
}

async function refreshAll(){
  await renderRequests();
  await renderFriends();
  await renderStories();
}

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
}

/**
 * Emergence — emergent language simulation.
 * Agents wander, find food, emit signals. Through reinforcement,
 * they converge on a shared vocabulary no one designed.
 */

const cv = document.getElementById("world");
const cx = cv.getContext("2d");
const W = 500, H = 500, NS = 10;

const COLORS = [
    "#e05555","#e08830","#d4af37","#6aad40","#2e9e5e",
    "#2e9e9e","#3070c0","#5e4eb8","#9040b0","#c04890"
];

// Parameters (bound to sliders)
let P = {
    lr:.18, decay:.002, conf:.35, range:75,
    iso:.012, rebel:.02, cerr:.008,
    pop:50, fspawn:.07, spd:5
};

let agents=[], foods=[], tick=0, gen=0, paused=false;
let totalFed=0, recentFinds=0, recentTicks=0;
let hist={con:[],eff:[],ent:[],vocab:[]}, timeline=[];
const MH = 250;

const rnd = (a,b) => a+Math.random()*(b-a);

// ── Agent ──────────────────────────────────────────────────────

class Agent {
    constructor() {
        this.x=rnd(15,W-15); this.y=rnd(15,H-15);
        this.vx=rnd(-.8,.8);  this.vy=rnd(-.8,.8);
        this.sig = Math.floor(Math.random()*NS);  // broadcast signal
        this.bel = new Float32Array(NS);           // belief per signal
        this.age=0; this.wins=0; this.nearby=0;
        this.energy = 70+rnd(0,30);
        this.state="wander"; this.target=null; this.source=null;
        this.emit=0; this.flash=0;
        this.wAngle=Math.random()*Math.PI*2; this.wTimer=0;
    }

    mutate() {
        if (this.nearby===0 && Math.random()<P.iso)
            this.sig = Math.floor(Math.random()*NS);
        if (this.age<400 && this.wins<3 && Math.random()<P.rebel)
            this.sig = ((this.sig+(Math.random()<.5?1:-1))%NS+NS)%NS;
    }

    decide() {
        // Direct sight (short range)
        let best=null, bd=55*55;
        for (const f of foods) {
            const d2=(f.x-this.x)**2+(f.y-this.y)**2;
            if (d2<bd) { bd=d2; best=f; }
        }
        if (best) { this.target=best; this.state="seek_food"; this.source=null; return; }

        // Follow trusted signal
        if (this.source && this.bel[this.source.sig]>.2) {
            this.state="seek_signal"; this.target=null; return;
        }
        this.state="wander"; this.target=null; this.source=null;
    }

    update() {
        this.age++; this.energy-=.02;
        if (this.emit>0) this.emit--;
        if (this.flash>0) this.flash--;
        for (let i=0;i<NS;i++) this.bel[i]=Math.max(0,this.bel[i]-P.decay);
        this.mutate(); this.decide();

        let fx=0, fy=0;
        if (this.state==="seek_food" && this.target) {
            if (!this.target._alive) { this.state="wander"; this.target=null; }
            else {
                const dx=this.target.x-this.x, dy=this.target.y-this.y;
                const d=Math.hypot(dx,dy);
                if (d>1) { fx+=dx/d*2.5; fy+=dy/d*2.5; }
            }
        } else if (this.state==="seek_signal" && this.source) {
            const dx=this.source.x-this.x, dy=this.source.y-this.y;
            const d=Math.hypot(dx,dy), pull=this.bel[this.source.sig]*2;
            if (d>1) { fx+=dx/d*pull; fy+=dy/d*pull; }
        } else {
            if (--this.wTimer<=0) { this.wAngle+=rnd(-.8,.8); this.wTimer=rnd(30,90)|0; }
            fx+=Math.cos(this.wAngle)*.6; fy+=Math.sin(this.wAngle)*.6;
        }

        this.vx=this.vx*.82+fx*.18; this.vy=this.vy*.82+fy*.18;
        const spd=Math.hypot(this.vx,this.vy);
        if (spd>1.4) { this.vx=this.vx/spd*1.4; this.vy=this.vy/spd*1.4; }
        this.x+=this.vx; this.y+=this.vy;

        // Soft walls
        if (this.x<10) this.vx+=.4; if (this.x>W-10) this.vx-=.4;
        if (this.y<10) this.vy+=.4; if (this.y>H-10) this.vy-=.4;
        this.x=Math.max(2,Math.min(W-2,this.x));
        this.y=Math.max(2,Math.min(H-2,this.y));

        // Pick up food
        for (const f of foods) {
            if (!f._alive) continue;
            if ((f.x-this.x)**2+(f.y-this.y)**2 < 144) {
                f._alive=false; this.energy=Math.min(100,this.energy+25);
                this.wins++; this.flash=20; this.emit=60;
                totalFed++; recentFinds++;
                if (this.source) this.bel[this.source.sig]=Math.min(1,this.bel[this.source.sig]+P.lr*1.5);
                this.bel[this.sig]=Math.min(1,this.bel[this.sig]+P.lr*.6);
                this.target=null; this.source=null; this.state="wander";
                break;
            }
        }
    }

    hear(sig, sx, sy, dist) {
        if (dist>P.range || dist<1) return;
        const str=1-dist/P.range;
        if (!this.source || str>.5) this.source={x:sx,y:sy,sig};
        if (Math.random() < P.conf*str*.03) {
            this.sig = Math.random()<P.cerr
                ? ((sig+(Math.random()<.5?1:-1))%NS+NS)%NS
                : sig;
        }
    }

    draw() {
        const c=COLORS[this.sig];
        // Emission wave
        if (this.emit>0) {
            const p=1-this.emit/60;
            cx.beginPath(); cx.arc(this.x,this.y,P.range*p,0,Math.PI*2);
            cx.strokeStyle=c; cx.globalAlpha=.1*(1-p); cx.lineWidth=1.5; cx.stroke(); cx.globalAlpha=1;
        }
        // Direction tail
        const spd=Math.hypot(this.vx,this.vy);
        if (spd>.3) {
            cx.beginPath(); cx.moveTo(this.x,this.y);
            cx.lineTo(this.x+this.vx/spd*7,this.y+this.vy/spd*7);
            cx.strokeStyle=c; cx.globalAlpha=.25; cx.lineWidth=1; cx.stroke(); cx.globalAlpha=1;
        }
        // Body
        const sz=this.flash>0?5.5:3.2, a=.5+Math.max(...this.bel)*.5;
        cx.beginPath(); cx.arc(this.x,this.y,sz,0,Math.PI*2);
        cx.globalAlpha=a; cx.fillStyle=c; cx.fill(); cx.globalAlpha=1;
        // Eat flash
        if (this.flash>0) {
            cx.beginPath(); cx.arc(this.x,this.y,sz+3,0,Math.PI*2);
            cx.strokeStyle="#fff"; cx.globalAlpha=this.flash/20*.6; cx.lineWidth=1.5; cx.stroke(); cx.globalAlpha=1;
        }
        // State pip
        if (this.state==="seek_food") { cx.fillStyle="#00b894"; cx.fillRect(this.x-1.5,this.y-8,3,3); }
        else if (this.state==="seek_signal") { cx.fillStyle=c; cx.globalAlpha=.5; cx.fillRect(this.x-1,this.y-7,2,2); cx.globalAlpha=1; }
        // Low energy
        if (this.energy<25) {
            cx.beginPath(); cx.arc(this.x,this.y,sz+2,0,Math.PI*2);
            cx.strokeStyle="rgba(220,60,60,.35)"; cx.lineWidth=.5; cx.stroke();
        }
    }
}

// ── World ──────────────────────────────────────────────────────

function spawnFood() {
    if (Math.random()<P.fspawn) foods.push({x:rnd(20,W-20),y:rnd(20,H-20),_alive:true,age:0});
}

function broadcast() {
    for (const a of agents) a.nearby=0;
    for (let i=0;i<agents.length;i++) {
        const a=agents[i];
        if (a.emit<=0) continue;
        for (let j=0;j<agents.length;j++) {
            if (i===j) continue;
            const b=agents[j], dist=Math.hypot(a.x-b.x,a.y-b.y);
            if (dist<P.range) { b.nearby++; b.hear(a.sig,a.x,a.y,dist); }
        }
    }
    for (let i=0;i<agents.length;i++)
        for (let j=i+1;j<agents.length;j++) {
            if ((agents[i].x-agents[j].x)**2+(agents[i].y-agents[j].y)**2<P.range**2) {
                agents[i].nearby++; agents[j].nearby++;
            }
        }
}

// ── Metrics ────────────────────────────────────────────────────

function calcMetrics() {
    const cnt=new Float32Array(NS);
    for (const a of agents) cnt[a.sig]++;
    let maxC=0, maxS=0;
    for (let i=0;i<NS;i++) if (cnt[i]>maxC) { maxC=cnt[i]; maxS=i; }
    const con = agents.length ? Math.round(maxC/agents.length*100) : 0;
    let active=0;
    for (let i=0;i<NS;i++) if (cnt[i]>agents.length*.03) active++;
    let ent=0;
    for (let i=0;i<NS;i++) if (cnt[i]>0) { const p=cnt[i]/agents.length; ent-=p*Math.log2(p); }
    return { con, active, ent:+ent.toFixed(2), cnt, maxS };
}

// ── Rendering ──────────────────────────────────────────────────

function drawWorld() {
    cx.clearRect(0,0,W,H); cx.fillStyle="#f7f5f0"; cx.fillRect(0,0,W,H);
    // Ground texture
    cx.globalAlpha=.03;
    for (let i=0;i<12;i++) { cx.beginPath(); cx.arc(rnd(0,W),rnd(0,H),rnd(15,40),0,Math.PI*2); cx.fillStyle="#b8b090"; cx.fill(); }
    cx.globalAlpha=1;
    // Food
    for (const f of foods) {
        if (!f._alive) continue; f.age++;
        const s=.9+Math.sin(f.age*.04)*.1;
        cx.beginPath(); cx.arc(f.x,f.y,4*s,0,Math.PI*2); cx.fillStyle="rgba(95,155,30,.85)"; cx.fill();
        cx.beginPath(); cx.arc(f.x-1,f.y-1.5,1.8,0,Math.PI*2); cx.fillStyle="rgba(150,200,70,.35)"; cx.fill();
    }
    for (const a of agents) a.draw();
}

function drawGraph(id, d1,c1,s1, d2,c2,s2) {
    const el=document.getElementById(id), g=el.getContext("2d"), GW=el.width, GH=el.height;
    g.clearRect(0,0,GW,GH);
    g.strokeStyle="rgba(0,0,0,.05)"; g.lineWidth=.5;
    for (let i=0;i<=4;i++) { const y=GH*i/4; g.beginPath(); g.moveTo(0,y); g.lineTo(GW,y); g.stroke(); }
    const line=(arr,col,sc)=>{
        if (arr.length<2) return;
        g.beginPath(); g.strokeStyle=col; g.lineWidth=1.5;
        arr.forEach((v,i)=>{ const x=i/(MH-1)*GW, y=GH-v/sc*GH*.85-GH*.07; i?g.lineTo(x,y):g.moveTo(x,y); });
        g.stroke();
    };
    line(d1,c1,s1); line(d2,c2,s2);
}

// ── UI bindings ────────────────────────────────────────────────

function updateBars(cnt) {
    const wrap=document.getElementById("bars");
    if (!wrap.children.length) {
        for (let i=0;i<NS;i++) { const b=document.createElement("div"); b.className="sig-bar"; wrap.appendChild(b); }
        const lw=document.getElementById("bar-labels");
        for (let i=0;i<NS;i++) { const s=document.createElement("span"); s.textContent=i; lw.appendChild(s); }
    }
    const mx=Math.max(1,...cnt);
    for (let i=0;i<NS;i++) {
        const b=wrap.children[i];
        b.style.height=Math.max(2,cnt[i]/mx*100)+"%";
        b.style.background=COLORS[i]; b.style.opacity=cnt[i]>0?1:.12;
    }
}

function updateLabel(s,con) {
    const el=document.getElementById("con-word");
    if (con>=70)      { el.textContent="Signal "+s+" is dominant"; el.style.color=COLORS[s]; }
    else if (con>=40) { el.textContent="Signal "+s+" forming...";  el.style.color=COLORS[s]; }
    else              { el.textContent="No consensus yet";         el.style.color="#a8a196"; }
}

function togglePause() {
    paused=!paused;
    document.getElementById("btn-pause").textContent=paused?"▶ Play":"⏸ Pause";
}

function babel() {
    for (const a of agents) {
        a.sig=Math.floor(Math.random()*NS);
        a.bel.fill(0); a.wins=0; a.age=0; a.source=null;
    }
}

function resetAll() {
    agents=[]; foods=[]; tick=0; gen=0; totalFed=0; recentFinds=0; recentTicks=0;
    hist={con:[],eff:[],ent:[],vocab:[]}; timeline=[];
    for (let i=0;i<P.pop;i++) agents.push(new Agent());
}

function bindSlider(id,key,vid,fmt) {
    const el=document.getElementById(id);
    if (!el) return;
    el.addEventListener("input", function() {
        P[key]=+this.value;
        document.getElementById(vid).textContent=fmt?fmt(+this.value):(+this.value).toFixed(2);
        if (key==="pop") { while(agents.length<P.pop) agents.push(new Agent()); while(agents.length>P.pop) agents.pop(); }
    });
}

bindSlider("r-lr","lr","v-lr");
bindSlider("r-decay","decay","v-decay",v=>v.toFixed(3));
bindSlider("r-conf","conf","v-conf");
bindSlider("r-range","range","v-range",v=>v.toFixed(0));
bindSlider("r-iso","iso","v-iso",v=>v.toFixed(3));
bindSlider("r-rebel","rebel","v-rebel",v=>v.toFixed(3));
bindSlider("r-cerr","cerr","v-cerr",v=>v.toFixed(3));
bindSlider("r-pop","pop","v-pop",v=>v.toFixed(0));
bindSlider("r-fspawn","fspawn","v-fspawn",v=>v.toFixed(2));
bindSlider("r-spd","spd","v-spd",v=>v.toFixed(0));

// ── Save ───────────────────────────────────────────────────────

async function saveExperiment() {
    const {con,active,ent,maxS} = calcMetrics();
    const data = {
        name: document.getElementById("exp-name").value.trim()||"Untitled",
        notes: document.getElementById("exp-notes").value.trim(),
        generation:gen, consensus:con, entropy:ent,
        active_signals:active, dominant_signal:maxS, total_food:totalFed,
        parameters:{...P}, timeline:timeline.slice(-100)
    };
    try {
        const res = await fetch("/api/save",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(data)});
        const r = await res.json();
        const st=document.getElementById("save-status");
        st.textContent="✓ Saved #"+r.id; setTimeout(()=>st.textContent="",3000);
    } catch(e) { console.error("Save failed",e); }
}

// ── Main loop ──────────────────────────────────────────────────

function loop() {
    requestAnimationFrame(loop);
    if (paused) return;
    for (let s=0;s<P.spd;s++) {
        tick++; recentTicks++;
        if (tick%500===0) gen++;
        spawnFood();
        foods=foods.filter(f=>f._alive);
        broadcast();
        for (const a of agents) a.update();
        for (let i=agents.length-1;i>=0;i--) {
            if (agents[i].energy<=0) { agents.splice(i,1); agents.push(new Agent()); }
        }
    }
    drawWorld();
    if (tick%20===0) {
        const {con,active,ent,cnt,maxS}=calcMetrics();
        const fr=recentTicks>0?Math.round(recentFinds/recentTicks*1000):0;
        document.getElementById("m-con").textContent=con+"%";
        document.getElementById("m-vocab").textContent=active+"/"+NS;
        document.getElementById("m-eff").textContent=fr;
        document.getElementById("m-ent").textContent=ent;
        document.getElementById("m-fed").textContent=totalFed;
        document.getElementById("gen-label").textContent="Generation "+gen+" · "+totalFed+" food found";
        updateBars(cnt); updateLabel(maxS,con);
        hist.con.push(con); hist.eff.push(Math.min(100,fr*4)); hist.ent.push(ent); hist.vocab.push(active);
        if (hist.con.length>MH) { hist.con.shift(); hist.eff.shift(); hist.ent.shift(); hist.vocab.shift(); }
        timeline.push({tick,consensus:con,entropy:ent,active_signals:active,find_rate:fr});
        if (timeline.length>500) timeline.shift();
        drawGraph("g-con",hist.con,"#6c5ce7",100,hist.eff,"#00b894",100);
        drawGraph("g-ent",hist.ent,"#fdcb6e",Math.log2(NS),hist.vocab,"#e17055",NS);
        if (recentTicks>300) { recentFinds=0; recentTicks=0; }
    }
}

resetAll(); loop();

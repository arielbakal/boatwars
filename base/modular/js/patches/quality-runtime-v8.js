// =====================================================
// TERRARIUM QUALITY V8 - RUNTIME (DORMANT)
// =====================================================
// Procedural hull panel texture and ship upgrade dressing.
//
// This layer never executed in the single-file prototype: it was invoked as
// `(typeof game !== 'undefined' ? game : null)` from a script block that could
// not see the engine, so its `if (!engine) return;` guard always fired. It is
// ported verbatim and gated off in patches/flags.js. See ROADMAP.md.

export default function installTerrariumQualityV8Runtime(engine) {
    'use strict';
    if (!engine || engine.__terrariumQualityV8Runtime) return;
    engine.__terrariumQualityV8Runtime = true;

    function makePanelTexture() {
        const size = 128;
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = size;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#e8e8e8'; ctx.fillRect(0,0,size,size);
        const img = ctx.getImageData(0,0,size,size);
        let s = 0x51f15e;
        const rand = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967295; };
        for (let i=0;i<img.data.length;i+=4) {
            const v = Math.floor((rand()-.5)*16);
            img.data[i] = Math.max(165, Math.min(250, img.data[i] + v));
            img.data[i+1] = Math.max(165, Math.min(250, img.data[i+1] + v));
            img.data[i+2] = Math.max(165, Math.min(250, img.data[i+2] + v));
        }
        ctx.putImageData(img,0,0);
        ctx.strokeStyle='rgba(50,50,50,.30)'; ctx.lineWidth=1;
        for (let x=0;x<=size;x+=32){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,size);ctx.stroke();}
        for (let y=0;y<=size;y+=32){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(size,y);ctx.stroke();}
        ctx.strokeStyle='rgba(255,255,255,.24)';
        for(let i=0;i<10;i++){const y=8+Math.floor(rand()*(size-16));ctx.beginPath();ctx.moveTo(rand()*36,y);ctx.lineTo(72+rand()*52,y+(rand()-.5)*3);ctx.stroke();}
        const tex = new THREE.CanvasTexture(canvas);
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(2.2, 3.8);
        tex.anisotropy = 2;
        return tex;
    }

    const panelTex = makePanelTexture();
    const upgraded = new WeakSet();
    function upgradeShip(boat) {
        const root = boat?.userData?.kineticV3;
        if (!root || upgraded.has(root)) return;
        upgraded.add(root);
        root.traverse(obj => {
            const mat = obj.material;
            if (!mat || Array.isArray(mat) || !mat.isMeshBasicMaterial) return;
            if (mat.transparent || mat.blending === THREE.AdditiveBlending || !mat.color) return;
            mat.map = panelTex;
            mat.needsUpdate = true;
        });
        // Add a pair of tiny asymmetrical antenna/sensor masts to break the pristine toy silhouette.
        const dark = new THREE.MeshBasicMaterial({ color: 0x182129, map: panelTex });
        const accent = new THREE.MeshBasicMaterial({ color: 0xb9ea84 });
        const sensorRoot = new THREE.Group();
        sensorRoot.name = 'quality-v8 ship sensor detail';
        sensorRoot.position.set(.68,.72,-.28);
        root.add(sensorRoot);
        const mast = new THREE.Mesh(new THREE.CylinderGeometry(.025,.035,.52,5), dark);
        mast.position.y=.26; mast.rotation.z=-.08; sensorRoot.add(mast);
        const sensor = new THREE.Mesh(new THREE.OctahedronGeometry(.075,0), accent);
        sensor.position.set(.025,.54,0); sensorRoot.add(sensor);
        const fin = new THREE.Mesh(new THREE.BoxGeometry(.035,.22,.28), dark);
        fin.position.set(-.82,.31,.72); fin.rotation.z=.12; root.add(fin);
    }

    let lastScan = 0;
    function tick(now) {
        if (now - lastScan > 700) {
            lastScan = now;
            if (engine.state?.activeBoat) upgradeShip(engine.state.activeBoat);
            engine.world?.scene?.traverse?.(obj => {
                if (obj?.userData?.type === 'spaceship') upgradeShip(obj);
            });
        }
        requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
    console.info('[Terrarium Quality V8] Character material maps and ship surface/sensor details active.');
}

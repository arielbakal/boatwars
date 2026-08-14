// =====================================================
// FRACTURE BIOSPHERE V10 (DORMANT)
// =====================================================
// Recursive 3D organisms, camera-anchored fractal sky, spectral contour
// synthesis and motion-reactive field rendering.
//
// This layer never executed in the single-file prototype: it was invoked as
// `(typeof game !== 'undefined' ? game : null)` from a script block that could
// not see the engine, so its `if (!engine) return;` guard always fired. It is
// ported verbatim and gated off in patches/flags.js. See ROADMAP.md.

import SphericalUtils from '../classes/SphericalUtils.js';
import WorldManager from '../classes/WorldManager.js';

export default function installFractureBiosphereV10(engine) {
    'use strict';
    if (!engine || engine.__fractureBiosphereV10) return;
    engine.__fractureBiosphereV10 = true;

    const world = engine.world;
    const renderer = world && world.renderer;
    if (!renderer || !THREE) return;

    // Remove the old CSS grade: V10 performs the image synthesis inside WebGL so
    // edge response, fractal sky and chromatic breakup share one coherent signal.
    const root = document.documentElement;
    const oldGrade = document.getElementById('visual-grade');
    const oldSpeed = document.getElementById('speed-lines');
    const oldGrain = document.getElementById('paper-grain');
    if (oldGrade) oldGrade.style.display = 'none';
    if (oldSpeed) oldSpeed.style.display = 'none';
    if (oldGrain) oldGrain.style.display = 'none';

    const fieldLabel = document.createElement('div');
    fieldLabel.id = 'v10-field-label';
    fieldLabel.textContent = 'recursive field / live';
    document.body.appendChild(fieldLabel);

    const pixelLabel = document.querySelector('.setting-row > span');
    if (pixelLabel && pixelLabel.textContent.trim().toUpperCase() === 'PIXEL') pixelLabel.textContent = 'RASTER';

    const clamp01 = v => Math.max(0, Math.min(1, v || 0));
    const smooth = (a, b, rate, dt) => a + (b - a) * (1 - Math.exp(-rate * dt));
    const rgb = c => {
        const cc = c && c.isColor ? c : new THREE.Color(c || 0xcaff9a);
        return `${Math.round(cc.r * 255)},${Math.round(cc.g * 255)},${Math.round(cc.b * 255)}`;
    };
    const hex = c => `#${(c && c.isColor ? c : new THREE.Color(c || 0xcaff9a)).getHexString()}`;

    // -------------------------------------------------------------------------
    // FULL-SCREEN DEMOSCENE FIELD
    // -------------------------------------------------------------------------
    const target = new THREE.WebGLRenderTarget(2, 2, {
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        format: THREE.RGBAFormat,
        type: THREE.UnsignedByteType,
        depthBuffer: true,
        stencilBuffer: false
    });
    target.texture.generateMipmaps = false;

    const postScene = new THREE.Scene();
    const postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const uniforms = {
        uScene: { value: target.texture },
        uResolution: { value: new THREE.Vector2(2, 2) },
        uTime: { value: 0 },
        uSpeed: { value: 0 },
        uImpact: { value: 0 },
        uDanger: { value: 0 },
        uAim: { value: 0 },
        uTurn: { value: 0 },
        uAccent: { value: new THREE.Color(0xcaff9a) },
        uSecond: { value: new THREE.Color(0x7d69e8) },
        uCamForward: { value: new THREE.Vector3(0,0,-1) },
        uCamRight: { value: new THREE.Vector3(1,0,0) },
        uCamUp: { value: new THREE.Vector3(0,1,0) }
    };

    const postMaterial = new THREE.ShaderMaterial({
        uniforms,
        depthTest: false,
        depthWrite: false,
        vertexShader: `
            varying vec2 vUv;
            void main() {
                vUv = uv;
                gl_Position = vec4(position.xy, 0.0, 1.0);
            }
        `,
        fragmentShader: `
            precision highp float;
            varying vec2 vUv;
            uniform sampler2D uScene;
            uniform vec2 uResolution;
            uniform float uTime;
            uniform float uSpeed;
            uniform float uImpact;
            uniform float uDanger;
            uniform float uAim;
            uniform float uTurn;
            uniform vec3 uAccent;
            uniform vec3 uSecond;
            uniform vec3 uCamForward;
            uniform vec3 uCamRight;
            uniform vec3 uCamUp;

            #define PI 3.14159265359

            float sat(float x){ return clamp(x,0.0,1.0); }
            float hash12(vec2 p){
                vec3 p3 = fract(vec3(p.xyx) * .1031);
                p3 += dot(p3, p3.yzx + 33.33);
                return fract((p3.x + p3.y) * p3.z);
            }
            mat2 rot(float a){ float c=cos(a),s=sin(a); return mat2(c,-s,s,c); }
            float luma(vec3 c){ return dot(c, vec3(.2126,.7152,.0722)); }

            float fbm(vec2 p){
                float f=0.0, a=.50;
                mat2 m=mat2(.80,.60,-.60,.80);
                for(int i=0;i<5;i++){
                    vec2 q=floor(p), r=fract(p);
                    r=r*r*(3.0-2.0*r);
                    float n=mix(mix(hash12(q),hash12(q+vec2(1,0)),r.x),
                                mix(hash12(q+vec2(0,1)),hash12(q+vec2(1,1)),r.x),r.y);
                    f += a*n;
                    p = m*p*2.03 + 7.17;
                    a *= .49;
                }
                return f;
            }

            // Folded recursive field: a compact Mandelbox/Kali-style signal.
            // It is anchored to camera direction below, so it behaves like a place
            // in the sky rather than a texture taped to the monitor.
            float recursiveField(vec2 p, float t){
                p *= 1.12;
                float glow=0.0;
                float scale=1.0;
                for(int i=0;i<7;i++){
                    p = abs(p);
                    p -= vec2(.62,.41);
                    p *= rot(.67 + sin(t*.09)*.035);
                    float d=max(.16,dot(p,p));
                    p = p/d - vec2(.48,.34);
                    float line=abs(length(p)-.74);
                    glow += exp(-line*(8.0 + float(i)*1.3))/scale;
                    scale *= 1.34;
                }
                return glow;
            }

            vec3 skySignal(vec2 uv, float sceneLum){
                vec2 p=(uv-.5)*vec2(uResolution.x/max(1.0,uResolution.y),1.0);
                vec3 rd=normalize(uCamForward + uCamRight*p.x*1.22 + uCamUp*p.y*1.22);
                vec2 sph=vec2(atan(rd.z,rd.x)/(2.0*PI)+.5, asin(clamp(rd.y,-1.0,1.0))/PI+.5);
                vec2 q=(sph-vec2(.5,.5))*vec2(5.6,3.25);
                q += vec2(fbm(q*1.16+uTime*.008), fbm(q*1.03-uTime*.006))*.55;
                float r=recursiveField(q,uTime);
                float dust=fbm(q*2.4 + vec2(uTime*.012,-uTime*.009));
                float fil=pow(sat(r*.54),1.7);
                float stars=pow(hash12(floor(sph*uResolution*.34)),38.0);
                vec3 col=mix(uSecond*.21,uAccent*.34,dust);
                col *= fil*(.17 + .19*uDanger);
                col += mix(uSecond,uAccent,dust)*stars*.24;
                float skyMask=(1.0-smoothstep(.045,.34,sceneLum));
                return col*skyMask;
            }

            void main(){
                vec2 uv=vUv;
                vec2 px=1.0/max(uResolution,vec2(1.0));
                vec2 centered=uv-.5;
                float radial=length(centered);

                // Motion never becomes a generic shake. It bends the image along a
                // directional, recursive field and spikes on actual impact.
                float warpNoise=fbm(uv*4.2 + vec2(uTime*.10,-uTime*.073));
                float drive=uSpeed*.52 + uImpact*.92 + abs(uTurn)*.18;
                vec2 warp=vec2(
                    sin(uv.y*25.0 + uTime*2.1 + warpNoise*5.0),
                    cos(uv.x*19.0 - uTime*1.7 + warpNoise*4.0)
                ) * px * (1.0 + drive*6.0);
                warp *= (.13 + drive*.42) * smoothstep(.08,.72,radial + uImpact*.18);
                vec2 suv=clamp(uv+warp,vec2(0.0),vec2(1.0));

                vec3 c=texture2D(uScene,suv).rgb;
                float lum=luma(c);

                // Directional contour estimate. The edge becomes a material: a tiny
                // spectral fracture, not a black comic outline.
                float lL=luma(texture2D(uScene,clamp(suv-vec2(px.x,0.0)*1.65,vec2(0.0),vec2(1.0))).rgb);
                float lR=luma(texture2D(uScene,clamp(suv+vec2(px.x,0.0)*1.65,vec2(0.0),vec2(1.0))).rgb);
                float lD=luma(texture2D(uScene,clamp(suv-vec2(0.0,px.y)*1.65,vec2(0.0),vec2(1.0))).rgb);
                float lU=luma(texture2D(uScene,clamp(suv+vec2(0.0,px.y)*1.65,vec2(0.0),vec2(1.0))).rgb);
                vec2 grad=vec2(lR-lL,lU-lD);
                float edge=sat(length(grad)*3.75);
                vec2 nrm=normalize(grad+vec2(1e-4));

                float split=(.45 + uSpeed*1.7 + uImpact*3.2 + edge*1.4);
                vec2 aberr=nrm*px*split;
                float rr=texture2D(uScene,clamp(suv+aberr,vec2(0.0),vec2(1.0))).r;
                float bb=texture2D(uScene,clamp(suv-aberr,vec2(0.0),vec2(1.0))).b;
                c.r=mix(c.r,rr,.17 + edge*.32 + uImpact*.18);
                c.b=mix(c.b,bb,.14 + edge*.28 + uSpeed*.12);

                // Cheap, controlled bloom from four taps. This is intentionally small:
                // luminous things should feel self-emissive without fogging the whole image.
                vec3 bloom=vec3(0.0);
                bloom += texture2D(uScene,clamp(suv+vec2(px.x*3.0,0.0),vec2(0.0),vec2(1.0))).rgb;
                bloom += texture2D(uScene,clamp(suv-vec2(px.x*3.0,0.0),vec2(0.0),vec2(1.0))).rgb;
                bloom += texture2D(uScene,clamp(suv+vec2(0.0,px.y*3.0),vec2(0.0),vec2(1.0))).rgb;
                bloom += texture2D(uScene,clamp(suv-vec2(0.0,px.y*3.0),vec2(0.0),vec2(1.0))).rgb;
                bloom*=.25;
                float hi=smoothstep(.57,.94,max(max(bloom.r,bloom.g),bloom.b));
                c += bloom*hi*(.09 + .08*uAim);

                // The quiet alien layer: recursive celestial structure only occupies
                // darkness and silhouette margins, so gameplay remains legible.
                c += skySignal(suv,lum);

                float contour=pow(edge,1.4);
                vec3 edgeInk=mix(uSecond,uAccent, .5 + .5*sin(uTime*.31 + uv.y*7.0));
                c += edgeInk*contour*(.026 + uAim*.032 + uImpact*.085);

                // Subtle signed posterisation that disappears in midtones. It makes
                // flat-shaded geometry feel screen-printed without reverting to pixel art.
                float posterMix=.055 + uDanger*.018;
                vec3 quant=floor(c*10.0 + .5)/10.0;
                c=mix(c,quant,posterMix*(1.0-smoothstep(.16,.68,lum)));

                // Filmic toe/shoulder without a generic LUT.
                c=max(c,vec3(0.0));
                c=c/(.86+c);
                c=pow(c,vec3(.94));
                c*=1.04;

                // Ordered micro-dither + temporal grain. No visible scanline layer.
                float n=hash12(gl_FragCoord.xy + fract(uTime)*173.17)-.5;
                float dither=(mod(gl_FragCoord.x+gl_FragCoord.y*2.0,4.0)-1.5)/255.0;
                c += n*(.010 + uImpact*.006) + dither*.70;

                // A very gentle optical vignette and danger pressure at the periphery.
                float vign=1.0-smoothstep(.44,.82,radial)*( .15 + uDanger*.13 );
                c*=vign;
                c += uSecond*uDanger*pow(sat(radial-.38),2.0)*.035;

                gl_FragColor=vec4(c,1.0);
            }
        `
    });
    const postQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), postMaterial);
    postScene.add(postQuad);

    let lastFrame = performance.now() * .001;
    let smoothSpeed = 0, smoothDanger = 0, smoothAim = 0, impact = 0, smoothTurn = 0;
    let lastHp = engine.state?.player?.hp || 20;
    let lastCameraQ = new THREE.Quaternion();
    let qReady = false;
    const size = new THREE.Vector2();
    const fwd = new THREE.Vector3(), right = new THREE.Vector3(), up = new THREE.Vector3();

    function syncTargetSize(){
        renderer.getDrawingBufferSize(size);
        const w=Math.max(2,Math.floor(size.x)), h=Math.max(2,Math.floor(size.y));
        if (target.width!==w || target.height!==h) target.setSize(w,h);
        uniforms.uResolution.value.set(w,h);
    }

    function updateSignal(now){
        const dt=Math.min(.05,Math.max(.001,now-lastFrame));
        lastFrame=now;
        const state=engine.state;
        let speedTarget=0;
        if(state?.isOnBoat && state.activeBoat?.userData?.stats){
            const s=state.activeBoat.userData.stats;
            speedTarget=clamp01(Math.abs(s.currentSpeed||0)/Math.max(.001,s.maxSpeed||1));
        }else if(state?.player?.vel){
            const expected=Math.max(.04,(state.player.speed||.12)+(state.player.speedBoost||0));
            speedTarget=clamp01(state.player.vel.length()/(expected*1.34));
        }
        const hp=state?.player?.hp ?? lastHp;
        const maxHp=Math.max(1,state?.player?.maxHp||20);
        const dangerTarget=clamp01(1-hp/maxHp);
        const shake=clamp01((state?.cameraShake||0)*3.0);
        if(hp<lastHp || shake>.17) impact=Math.max(impact,.82+shake*.18);
        lastHp=hp;
        impact=Math.max(0,impact-dt*2.15);

        const crosshair=document.getElementById('breach-crosshair');
        const aimTarget=(crosshair && getComputedStyle(crosshair).display!=='none') ? (crosshair.classList.contains('charging')?1:.55) : 0;
        smoothSpeed=smooth(smoothSpeed,speedTarget,6.2,dt);
        smoothDanger=smooth(smoothDanger,dangerTarget,3.6,dt);
        smoothAim=smooth(smoothAim,aimTarget,8.0,dt);

        const q=world.camera.quaternion;
        let turnTarget=0;
        if(qReady){
            const dot=Math.min(1,Math.abs(q.dot(lastCameraQ)));
            turnTarget=clamp01((2*Math.acos(dot))/Math.max(.001,dt)/4.2);
        }
        lastCameraQ.copy(q); qReady=true;
        smoothTurn=smooth(smoothTurn,turnTarget,8.5,dt);

        uniforms.uTime.value=now;
        uniforms.uSpeed.value=smoothSpeed;
        uniforms.uImpact.value=Math.max(impact,shake*.7);
        uniforms.uDanger.value=smoothDanger;
        uniforms.uAim.value=smoothAim;
        uniforms.uTurn.value=smoothTurn;

        fwd.set(0,0,-1).applyQuaternion(q).normalize();
        right.set(1,0,0).applyQuaternion(q).normalize();
        up.set(0,1,0).applyQuaternion(q).normalize();
        uniforms.uCamForward.value.copy(fwd);
        uniforms.uCamRight.value.copy(right);
        uniforms.uCamUp.value.copy(up);

        const palette=state?.palette;
        if(palette){
            const a=(palette.accent||palette.floraAccent||palette.flora||new THREE.Color(0xcaff9a));
            const b=(palette.creature||palette.water||new THREE.Color(0x7d69e8)).clone();
            b.offsetHSL(.09,.08,.04);
            uniforms.uAccent.value.copy(a).lerp(new THREE.Color(0xdcffb4),.12);
            uniforms.uSecond.value.copy(b).lerp(new THREE.Color(0x7564e8),.30);
            root.style.setProperty('--v10-accent',hex(a));
            root.style.setProperty('--v10-accent-rgb',rgb(a));
        }
    }

    // Patch the single rendering choke-point, leaving simulation and camera code alone.
    const originalRender = WorldManager.prototype.render;
    WorldManager.prototype.render = function fractureFieldRenderV10(){
        if(this !== world) return originalRender.call(this);
        const now=performance.now()*.001;
        if(this.stars){
            this.stars.rotation.y=now*.0031;
            this.stars.rotation.x=Math.sin(now*.037)*.018;
            this.stars.material.opacity=.64+Math.sin(now*.41)*.075;
        }
        syncTargetSize();
        updateSignal(now);
        renderer.setRenderTarget(target);
        renderer.clear();
        renderer.render(this.scene,this.camera);
        renderer.setRenderTarget(null);
        renderer.clear();
        renderer.render(postScene,postCamera);
    };

    // -------------------------------------------------------------------------
    // RECURSIVE 3D ORGANISMS — real scene geometry, not only a screen filter.
    // -------------------------------------------------------------------------
    const fractalRoots = [];
    let lastPlanetSignature = '';
    const seedRand = seed => {
        let s=(seed|0)||1;
        return () => { s^=s<<13; s^=s>>>17; s^=s<<5; return (s>>>0)/4294967295; };
    };

    function makeRecursiveOrganism(planet,index,seed){
        const rand=seedRand(seed);
        const rootObj=new THREE.Group();
        rootObj.name='V10 recursive organism';
        rootObj.userData.__v10Fractal=true;
        rootObj.userData.phase=rand()*Math.PI*2;
        rootObj.userData.spin=(rand()-.5)*.11;
        rootObj.userData.index=index;
        rootObj.userData.spinAngle=0;

        const baseColor=(planet.palette?.accent || engine.state?.palette?.accent || new THREE.Color(0xcaff9a)).clone();
        const second=(planet.palette?.creature || engine.state?.palette?.creature || new THREE.Color(0x7d69e8)).clone();
        const mat=new THREE.MeshBasicMaterial({
            color:baseColor,
            transparent:true,
            opacity:.58,
            blending:THREE.AdditiveBlending,
            depthWrite:false,
            fog:true
        });
        const coreMat=new THREE.MeshBasicMaterial({
            color:second,
            transparent:true,
            opacity:.38,
            blending:THREE.AdditiveBlending,
            depthWrite:false,
            fog:true
        });

        const positions=[];
        function branch(p,scale,depth,twist){
            positions.push({p:p.clone(),s:scale,r:twist});
            if(depth<=0) return;
            const arm=.44*scale;
            const rises=[
                new THREE.Vector3(0,1.0,0),
                new THREE.Vector3(.82,.33,.48),
                new THREE.Vector3(-.76,.29,.56),
                new THREE.Vector3(.05,.25,-.95)
            ];
            for(let i=0;i<4;i++){
                const v=rises[i].clone().applyAxisAngle(new THREE.Vector3(0,1,0),twist+depth*.37);
                const child=p.clone().addScaledVector(v,arm);
                branch(child,scale*.56,depth-1,twist+(i-1.5)*.22);
            }
        }
        branch(new THREE.Vector3(0,.18,0),.58,2,rand()*Math.PI*2);

        const geo=new THREE.TetrahedronGeometry(1,0);
        const inst=new THREE.InstancedMesh(geo,mat,positions.length);
        const dummy=new THREE.Object3D();
        positions.forEach((o,i)=>{
            dummy.position.copy(o.p);
            dummy.scale.setScalar(Math.max(.028,o.s*.22));
            dummy.rotation.set(o.r*.35,o.r,o.r*.2);
            dummy.updateMatrix();
            inst.setMatrixAt(i,dummy.matrix);
        });
        inst.instanceMatrix.needsUpdate=true;
        rootObj.add(inst);

        const core=new THREE.Mesh(new THREE.IcosahedronGeometry(.18,1),coreMat);
        core.position.y=.31;
        rootObj.add(core);
        const ring=new THREE.Mesh(new THREE.TorusGeometry(.31,.013,5,38),coreMat);
        ring.position.y=.31;
        ring.rotation.x=Math.PI*.5;
        rootObj.add(ring);
        rootObj.userData.core=core;
        rootObj.userData.ring=ring;

        // Deterministic, broad placement away from the immediate starter pole.
        const theta=(index*1.71 + (seed%13)*.17)%(Math.PI*2);
        const y=-.45 + ((seed%17)/16)*.75;
        const rr=Math.sqrt(Math.max(.01,1-y*y));
        const normal=new THREE.Vector3(Math.cos(theta)*rr,y,Math.sin(theta)*rr).normalize();
        const terrainRadius=SphericalUtils.sampleTerrainHeight(planet,normal);
        rootObj.position.copy(planet.center).addScaledVector(normal,terrainRadius+.06);
        rootObj.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),normal);
        rootObj.userData.baseQ=rootObj.quaternion.clone();
        rootObj.scale.setScalar(.82 + index*.07);
        world.add(rootObj);
        fractalRoots.push(rootObj);
    }

    function rebuildFractalsIfNeeded(){
        const planets=engine.state?.islands || [];
        if(!planets.length) return;
        const sig=planets.map(p=>`${p.center?.x?.toFixed?.(1)},${p.center?.y?.toFixed?.(1)},${p.center?.z?.toFixed?.(1)},${p.radius}`).join('|');
        if(sig===lastPlanetSignature && fractalRoots.some(o=>o.parent)) return;
        for(const o of fractalRoots.splice(0)) if(o.parent) world.remove(o);
        lastPlanetSignature=sig;
        planets.forEach((p,i)=>{
            makeRecursiveOrganism(p,i,0x3917+i*997);
            if(i>0) makeRecursiveOrganism(p,i,0x8173+i*1597);
        });
    }

    // -------------------------------------------------------------------------
    // ORGANIC MOTION PASS — subtle local-space sway on static flora only.
    // -------------------------------------------------------------------------
    const living = new Map();
    let scanClock=0;
    function scanLiving(){
        const entities=engine.state?.entities || [];
        for(const e of entities){
            const type=e?.userData?.type;
            if(!e || !['tree','bush','grass','flower','floraExtra'].includes(type) || living.has(e)) continue;
            living.set(e,{
                baseQ:e.quaternion.clone(),
                phase:(e.position.x*1.73+e.position.y*.91+e.position.z*1.21)%6.283,
                amp:type==='tree'?.018:type==='bush'?.026:.045
            });
        }
        for(const [e] of living) if(!e.parent) living.delete(e);
    }
    const swayQ=new THREE.Quaternion();
    const fractalSpinQ=new THREE.Quaternion();
    const localY=new THREE.Vector3(0,1,0);
    const swayEuler=new THREE.Euler();
    function animateLiving(now){
        for(const [e,d] of living){
            const a=Math.sin(now*(.72 + (d.phase%1)*.25)+d.phase)*d.amp;
            const b=Math.cos(now*.53+d.phase*1.37)*d.amp*.62;
            swayEuler.set(a,0,b,'XYZ');
            swayQ.setFromEuler(swayEuler);
            e.quaternion.copy(d.baseQ).multiply(swayQ);
        }
        for(const f of fractalRoots){
            if(!f.parent) continue;
            const ph=f.userData.phase||0;
            f.userData.spinAngle += (f.userData.spin||0)*.008;
            fractalSpinQ.setFromAxisAngle(localY,f.userData.spinAngle);
            f.quaternion.copy(f.userData.baseQ).multiply(fractalSpinQ);
            const pulse=1 + Math.sin(now*.83+ph)*.028 + Math.sin(now*2.17+ph)*.009;
            if(f.userData.core) f.userData.core.scale.setScalar(pulse);
            if(f.userData.ring){
                f.userData.ring.rotation.z=now*(.13+(f.userData.index||0)*.011)+ph;
                f.userData.ring.scale.setScalar(.96+Math.sin(now*.41+ph)*.07);
            }
        }
    }

    function maintenance(nowMs){
        const now=nowMs*.001;
        if(now-scanClock>.75){
            scanClock=now;
            rebuildFractalsIfNeeded();
            scanLiving();
        }
        animateLiving(now);
        requestAnimationFrame(maintenance);
    }
    requestAnimationFrame(maintenance);

    // Preserve explicit user pixelation choice, but start the new visual system crisp.
    if(engine.ui?.pixelSlider && Number(engine.ui.pixelSlider.value)===8){
        engine.ui.pixelSlider.value='0';
        world.applyPixelation(0);
    }

    console.info('[Fracture Biosphere V10] recursive 3D organisms, camera-anchored fractal sky, spectral contour synthesis and motion-reactive field rendering active.');
}

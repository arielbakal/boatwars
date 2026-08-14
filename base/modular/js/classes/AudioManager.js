// =====================================================
// AUDIO MANAGER CLASS
// =====================================================

export default class AudioManager {
    constructor() {
        const AC = window.AudioContext || window.webkitAudioContext;
        this.ctx = new AC();
        this.synth = null;
        this.isMuted = false;
        this.previousSliderVal = 50;
        this.MASTER_GAIN_CAP = 0.2;
        this.songHash = "#9n31s0k0l00e0ct2ma7g0fj07r1i0o432T7v1u07f30p12k12b2q0z10v631d07HW0oc054R081000h0IbE1b9T0v2u00f11a8q1w10u84cd09w4h8E1bdT1v3u01f20e0269q00d0aAbF7B5Q0205P5aa0E177T3v2u03f10beq30a21d04SJzqiiih9999iijsE186b0ic1848ic0014j000h8g014h0g4100004h4x410g400p21-IR_0qGSrzYsddvYPnWqtLmrb_j4ttAv7snTdQ_MwqjHZdJ2OY2CzMh70At97khQAth7ipuwhQAt97khRDdPLWOewOMkTB_EL0jzQOBBcwkTBdhjkblheDFaqiCwQg0";
    }

    resume() { if (this.ctx.state === 'suspended') this.ctx.resume(); }

    chirp(f1, f2, dur, vol = 0.1) {
        this.resume();
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.frequency.setValueAtTime(f1, this.ctx.currentTime);
        osc.frequency.linearRampToValueAtTime(f2, this.ctx.currentTime + dur);
        gain.gain.setValueAtTime(0, this.ctx.currentTime);
        gain.gain.linearRampToValueAtTime(vol, this.ctx.currentTime + (dur * 0.1));
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + dur);
        osc.start();
        osc.stop(this.ctx.currentTime + dur);
    }

    select() { this.chirp(600, 900, 0.15, 0.05); }
    pickup() { this.chirp(300, 500, 0.2, 0.1); }
    place() { this.chirp(500, 300, 0.2, 0.1); }
    pop() { this.chirp(800, 1000, 0.1, 0.05); }
    chop() { this.chirp(400, 200, 0.08, 0.12); }
    step(speed01 = 0.5) { this.chirp(105 + speed01 * 34, 54 + speed01 * 18, 0.075, 0.018 + speed01 * 0.022); }
    attack() { this.chirp(150, 55, 0.12, 0.11); }
    hit() { this.chirp(430, 170, 0.09, 0.07); }
    purge() { this.chirp(180, 720, 0.32, 0.09); }
    treeFall() { this.chirp(300, 80, 0.4, 0.15); }
    sail() { this.chirp(200, 350, 0.3, 0.08); setTimeout(() => this.chirp(350, 500, 0.2, 0.06), 200); }
    boatBuild() { this.chirp(300, 600, 0.3, 0.1); setTimeout(() => this.chirp(600, 800, 0.15, 0.08), 200); setTimeout(() => this.chirp(800, 1000, 0.1, 0.06), 400); }
    eat() { this.chirp(400, 500, 0.08, 0.05); setTimeout(() => this.chirp(400, 500, 0.08, 0.05), 120); }
    hungry() { this.chirp(500, 400, 0.4, 0.08); setTimeout(() => this.chirp(420, 350, 0.4, 0.06), 200); }
    sing() { this.chirp(600, 800, 0.1, 0.05); setTimeout(() => this.chirp(800, 1000, 0.1, 0.05), 150); setTimeout(() => this.chirp(1000, 700, 0.2, 0.05), 300); }
    layEgg() { this.chirp(400, 200, 0.15, 0.1); }
    die() { this.chirp(300, 100, 0.6, 0.1); }
    hurt() { this.chirp(200, 100, 0.15, 0.12); setTimeout(() => this.chirp(150, 80, 0.1, 0.08), 100); }

    pet() {
        this.resume();
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        const lfo = this.ctx.createOscillator();
        lfo.frequency.value = 25;
        const lfoGain = this.ctx.createGain();
        lfoGain.gain.value = 30;
        lfo.connect(lfoGain);
        lfoGain.connect(osc.frequency);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.type = 'triangle';
        osc.frequency.value = 200;
        gain.gain.setValueAtTime(0.05, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.5);
        osc.start(); lfo.start();
        osc.stop(this.ctx.currentTime + 0.5);
        lfo.stop(this.ctx.currentTime + 0.5);
    }

    explode() {
        this.resume();
        const noise = this.ctx.createBufferSource();
        const buffer = this.ctx.createBuffer(1, this.ctx.sampleRate * 0.5, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
        noise.buffer = buffer;
        const gain = this.ctx.createGain();
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(300, this.ctx.currentTime);
        filter.frequency.exponentialRampToValueAtTime(50, this.ctx.currentTime + 0.5);
        noise.connect(filter);
        filter.connect(gain);
        gain.connect(this.ctx.destination);
        gain.gain.setValueAtTime(0.4, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.5);
        noise.start();
        noise.stop(this.ctx.currentTime + 0.5);
    }

    startMusic(worldDNA, volSlider, volIcon, settingsBtn, settingsPopup, sfx) {
        const targetVol = (parseFloat(volSlider.value) / 100) * this.MASTER_GAIN_CAP;
        if (!this.synth) {
            if (typeof beepbox === 'undefined') return;
            const { Synth } = beepbox;
            this.synth = new Synth(this.songHash);
            volSlider.addEventListener("input", (e) => {
                const val = parseFloat(e.target.value);
                if (this.synth) this.synth.volume = (val / 100) * this.MASTER_GAIN_CAP;
                volIcon.innerText = val <= 0 ? "🔇" : "🔊";
                this.isMuted = val <= 0;
            });
            volIcon.addEventListener("click", () => {
                if (!this.synth) return;
                if (this.isMuted) {
                    volSlider.value = this.previousSliderVal || 50;
                    this.synth.volume = (parseFloat(volSlider.value) / 100) * this.MASTER_GAIN_CAP;
                    volIcon.innerText = "🔊";
                    this.isMuted = false;
                } else {
                    this.previousSliderVal = parseFloat(volSlider.value) || 50;
                    volSlider.value = 0;
                    this.synth.volume = 0;
                    volIcon.innerText = "🔇";
                    this.isMuted = true;
                }
            });
            settingsBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                settingsPopup.classList.toggle('open');
                sfx.select();
            });
            window.addEventListener('click', (e) => {
                if (settingsPopup.classList.contains('open') && !settingsPopup.contains(e.target) && e.target !== settingsBtn) {
                    settingsPopup.classList.remove('open');
                }
            });
            this.synth.volume = targetVol;
            this.synth.play();
        } else {
            if (this.synth.audioContext && this.synth.audioContext.state === 'suspended') this.synth.audioContext.resume();
            this.synth.volume = targetVol;
            this.synth.play();
        }
        this.randomize(worldDNA);
    }

    randomize(dna) {
        if (!this.synth || !this.synth.song) return;
        const channel = this.synth.song.channels[1];
        const instrument = channel.instruments[0];
        instrument.type = 0;
        instrument.chipWave = Math.floor(Math.random() * 9);
        instrument.unison = Math.floor(Math.random() * 4);
        instrument.transition = Math.floor(Math.random() * 4);
        if (instrument.envelopes.length > 0) instrument.envelopes[0].punch = Math.floor(Math.random() * 4) * 20;
        instrument.volume = 0;
        this.synth.setSong(this.synth.song);
    }

    fadeOut() { if (this.synth) this.synth.volume = 0; }
}


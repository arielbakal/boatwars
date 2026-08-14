

import LLMService from '../services/LLMService.js';

export default class ChatManager {
    constructor(engine) {
        this.engine = engine;
        this.llm = new LLMService();
        this.isOpen = false;
        this.currentEntity = null;
        this.history = [];
        this.ui = {
            container: document.getElementById('chat-interface'),
            messages: document.getElementById('chat-messages'),
            input: document.getElementById('chat-input'),
            sendBtn: document.getElementById('chat-send-btn'),
            closeBtn: document.getElementById('chat-close-btn'),
            typingIndicator: document.getElementById('chat-typing')
        };

        this.setupEventListeners();
    }

    setupEventListeners() {
        if (!this.ui.sendBtn) return; // UI might not be injected yet

        this.ui.sendBtn.addEventListener('click', () => this.sendMessage());

        this.ui.input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') this.sendMessage();
            // Prevent 'E' key from propagating to game if chat is open (handled by stopping propagation on the container usually, but good to be safe)
            e.stopPropagation();
        });

        this.ui.closeBtn.addEventListener('click', () => this.closeChat());
    }

    async openChat(entity) {
        if (!this.ui.container) return;

        this.isOpen = true;
        this.currentEntity = entity;
        this.history = []; // Reset history for new conversation
        this.ui.container.style.display = 'flex';
        this.ui.messages.innerHTML = '';
        this.ui.input.value = '';
        this.ui.input.focus();

        // Load Lore
        let lore = `You are Chief Ruru, guardian of the Starting Planet in a five-world solar system.
You are small, proud, mystical, slightly paranoid, and friendly.
The player is a sky-traveler who must build a ship and purge the blight from every planetary world-heart.
Warn them that the central sun is lethal and that four nearby logs can become a spacecraft.
Always refer to yourself in third person as "Great Ruru" and keep replies to two or three sentences.`;
        if (entity.userData.loreFile) {
            try {
                const res = await fetch(entity.userData.loreFile);
                if (res.ok) lore = await res.text();
            } catch (err) {
                console.warn("Could not load lore:", err);
            }
        }

        this.llm.setSystemPrompt(lore);

        // Initial greeting
        this.addMessage("System", "Connected to " + (entity.userData.name || "NPC"));
    }

    closeChat() {
        this.isOpen = false;
        this.ui.container.style.display = 'none';
        this.currentEntity = null;

        // Request pointer lock back if needed, or just let user click
        // this.engine.world.renderer.domElement.requestPointerLock();
    }

    addMessage(sender, text, isUser = false) {
        const div = document.createElement('div');
        div.className = `message ${isUser ? 'user-message' : 'npc-message'}`;
        div.innerHTML = `<strong>${sender}:</strong> ${text}`;
        this.ui.messages.appendChild(div);
        this.ui.messages.scrollTop = this.ui.messages.scrollHeight;
    }

    async sendMessage() {
        if (this.isSending) return;
        const text = this.ui.input.value.trim();
        if (!text) return;

        this.isSending = true;
        this.ui.sendBtn.disabled = true;
        this.addMessage("You", text, true);
        this.ui.input.value = '';
        this.ui.typingIndicator.style.display = 'block';

        const response = await this.llm.sendChat(text, this.history);

        this.ui.typingIndicator.style.display = 'none';
        this.addMessage(this.currentEntity?.userData.name || "NPC", response, false);

        this.history.push({ role: "user", content: text });
        this.history.push({ role: "assistant", content: response });

        this.isSending = false;
        this.ui.sendBtn.disabled = false;
        this.ui.input.focus();
    }
}


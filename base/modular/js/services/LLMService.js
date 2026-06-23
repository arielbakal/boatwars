export default class LLMService {
    constructor() {
        this.systemPrompt = "You are a helpful assistant in a video game.";
        this.fallbackResponses = [
            "Hmm, interesting... Tell me more.",
            "I don't have much to say about that.",
            "*Nods slowly*",
            "The island holds many secrets...",
            "I've been here a long time, traveler.",
            "Be careful out there.",
            "Have you explored the whole island yet?",
            "*Looks around nervously*",
            "I wish I could help more.",
            "That's a good question... I'm not sure."
        ];
    }

    setSystemPrompt(prompt) {
        this.systemPrompt = prompt;
    }

    async sendChat(userMessage, history = []) {
        // No LLM integration — return a random fallback response
        const idx = Math.floor(Math.random() * this.fallbackResponses.length);
        return this.fallbackResponses[idx];
    }
}

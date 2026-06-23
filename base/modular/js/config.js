// =====================================================
// CONFIG - Gemini LLM settings (client-side)
// =====================================================
// NOTE: This is a static browser app with no build step, so everything here
// ships to the client and is publicly visible. NEVER put a real API key here
// -- it would be exposed to every visitor. For real LLM use, proxy the request
// through the server (server/index.js) and keep the key in a server-side
// environment variable.
//
// LLM is currently disabled (LLMService returns canned fallback responses),
// so an empty key is fine and the game runs without it.

export const API_KEY = "";
export const API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent";
export const AI_MODEL = "gemini-1.5-flash-latest";

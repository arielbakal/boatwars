// =====================================================
// POCKET TERRARIUM - MAIN ENTRY POINT
// =====================================================

import GameEngine from './classes/GameEngine.js';
import { installCorePatches, installEnginePatches } from './patches/index.js';

// Prototype patches first: they rewrite the factory and world material paths
// that world generation reads.
installCorePatches();

// Initialize the game
const game = new GameEngine();

installEnginePatches(game);

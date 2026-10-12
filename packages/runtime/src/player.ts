/**
 * Entry point of the standalone player script (`rowan-player.js`) that exported games
 * load. It exposes the player as the global `RowanPlayer`.
 */
import { ENGINE_VERSION } from '@rowan/core';
import { bootGame } from './bootGame';

export const boot = bootGame;
export const version = ENGINE_VERSION;

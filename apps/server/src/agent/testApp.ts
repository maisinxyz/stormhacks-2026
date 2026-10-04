// Builds a Fastify app with B1 registered, for tests and the standalone dev server.
import Fastify from 'fastify';
import { registerB1, type B1Options } from './plugin';
import { stubMedia, stubPets } from './devStubs';

export async function buildB1App(overrides: Partial<B1Options> = {}, logger = false) {
  const app = Fastify({ logger });
  const b1 = await registerB1(app, { pets: stubPets, media: stubMedia, ...overrides });
  await app.ready();
  return { app, ...b1 };
}

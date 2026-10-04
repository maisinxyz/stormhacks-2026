// Stand-ins for B2's internal interfaces (PRD B2.3) until B2 wires the real ones.
import type { MediaService, PetInfo, PetsRepo } from './types';

const DEMO_PETS: Record<string, PetInfo> = {
  dog: { id: 'dog', name: 'Biscuit', species: 'dog', personality: { eager: 0.9, sassy: 0.2, anxious: 0.2, chatty: 0.5 } },
  cat: { id: 'cat', name: 'Miso', species: 'cat', personality: { eager: 0.3, sassy: 0.9, anxious: 0.1, chatty: 0.4 } },
  rodent: { id: 'rodent', name: 'Pip', species: 'rodent', personality: { eager: 0.5, sassy: 0.1, anxious: 0.9, chatty: 0.5 } },
};

export const stubPets: PetsRepo = {
  async get(petId) {
    return DEMO_PETS[petId] ?? { ...DEMO_PETS.dog, id: petId };
  },
};

/** No image service: returns no URL so the runner falls back to a preset prop. */
export const stubMedia: MediaService = {
  async generateProp() { return { imageUrl: '' }; },
};

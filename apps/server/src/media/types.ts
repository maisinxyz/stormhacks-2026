// B2-local validation. Shared @fetch/contracts remains owned by F2.
import { z } from 'zod';
export const speciesSchema = z.enum(['dog', 'cat', 'rodent', 'bird']);
export type Species = z.infer<typeof speciesSchema>;
export const personalitySchema = z.object({ eager: z.number().min(0).max(1), sassy: z.number().min(0).max(1), anxious: z.number().min(0).max(1), chatty: z.number().min(0).max(1) }).strict();
export const statsSchema = z.object({ energy: z.number().min(0).max(100), happiness: z.number().min(0).max(100), hunger: z.number().min(0).max(100) }).strict();
export const petMetadataSchema = z.object({ name: z.string().trim().min(1).max(80), species: speciesSchema, personality: personalitySchema.optional(), stats: statsSchema.optional(), voiceId: z.string().min(1).max(100).optional() }).strict();
export const petPatchSchema = petMetadataSchema.omit({ species: true }).partial().extend({ stats: statsSchema.partial().optional(), personality: personalitySchema.partial().optional() }).strict();
export const defaults: Record<Species, z.infer<typeof personalitySchema>> = {
  dog: { eager: .9, sassy: .1, anxious: .2, chatty: .5 }, cat: { eager: .4, sassy: .9, anxious: .2, chatty: .3 },
  rodent: { eager: .6, sassy: .2, anxious: .8, chatty: .4 }, bird: { eager: .8, sassy: .6, anxious: .3, chatty: .9 }
};
export interface PetBundle {
  id: string; name: string; species: Species; splatUrl: string; rigUrl: string; weightsUrl: string; thumbnailUrl: string;
  voiceId?: string; personality: z.infer<typeof personalitySchema>; stats: z.infer<typeof statsSchema>; createdAt: string;
}

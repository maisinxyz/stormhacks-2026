import type { BusEvent } from '@fetch/contracts';

type Cb = (e: BusEvent) => void;

export class Bus {
  private l = new Map<string, Cb[]>();
  on<T extends BusEvent['type']>(t: T, cb: (e: Extract<BusEvent, { type: T }>) => void) {
    this.l.set(t, [...(this.l.get(t) ?? []), cb as Cb]);
  }
  emit(e: BusEvent) { this.l.get(e.type)?.forEach(cb => cb(e)); }
}

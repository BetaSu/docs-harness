export type { Envelope, FailureEnvelope, SuccessEnvelope } from './lib/envelope.js';
export { buildSignal } from './lib/signal-patterns.js';
export { readIntentObservations } from './lib/intents.js';
export type {
  IntentCommandFilter,
  IntentObservation,
  ReadIntentObservationsInput,
  ReadIntentObservationsResult,
} from './lib/intents.js';
export type { FrictionPattern, Signal, SignalTarget } from './lib/signal-patterns.js';
export { markSignalsHandled, readSignals, writeSignals } from './lib/signals.js';
export type {
  MarkSignalsHandledResult,
  ReadSignalsInput,
  ReadSignalsResult,
  SignalHandledFilter,
  StoredSignal,
  WriteSignalsInput,
} from './lib/signals.js';

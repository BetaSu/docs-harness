export type SuccessEnvelope<T> = {
  ok: true;
  data: T;
};

export type FailureEnvelope = {
  ok: false;
  error: {
    type: string;
    message: string;
    hint?: string;
    confirm?: string;
  };
};

export type Envelope<T> = SuccessEnvelope<T> | FailureEnvelope;

export class CliError extends Error {
  readonly type: string;
  readonly hint?: string;
  readonly confirm?: string;

  constructor(input: { type: string; message: string; hint?: string; confirm?: string }) {
    super(input.message);
    this.name = 'CliError';
    this.type = input.type;
    this.hint = input.hint;
    this.confirm = input.confirm;
  }
}

export function writeSuccess<T>(data: T): void {
  writeEnvelope({ ok: true, data });
}

export function writeFailure(error: unknown): void {
  if (error instanceof CliError) {
    writeEnvelope({
      ok: false,
      error: {
        type: error.type,
        message: error.message,
        ...(error.hint ? { hint: error.hint } : {}),
        ...(error.confirm ? { confirm: error.confirm } : {}),
      },
    });
    return;
  }

  const message = error instanceof Error ? error.message : String(error);
  writeEnvelope({
    ok: false,
    error: {
      type: 'runtime',
      message,
      hint: 'Retry the command or run docs-harness skills read core.',
    },
  });
}

function writeEnvelope(value: Envelope<unknown>): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

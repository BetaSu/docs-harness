export type SuccessEnvelope<T> = {
  ok: true;
  data: T;
};

export type FailureEnvelope = {
  ok: false;
  error: {
    code: string;
    message: string;
    hint?: string;
    confirm?: string;
    issues?: Array<Record<string, unknown>>;
  };
};

export type Envelope<T> = SuccessEnvelope<T> | FailureEnvelope;

export class CliError extends Error {
  readonly code: string;
  readonly hint?: string;
  readonly confirm?: string;
  readonly issues?: Array<Record<string, unknown>>;

  constructor(input: {
    code: string;
    message: string;
    hint?: string;
    confirm?: string;
    issues?: Array<Record<string, unknown>>;
  }) {
    super(input.message);
    this.name = 'CliError';
    this.code = input.code;
    this.hint = input.hint;
    this.confirm = input.confirm;
    this.issues = input.issues;
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
        code: error.code,
        message: error.message,
        ...(error.hint ? { hint: error.hint } : {}),
        ...(error.confirm ? { confirm: error.confirm } : {}),
        ...(error.issues ? { issues: error.issues } : {}),
      },
    });
    return;
  }

  const message = error instanceof Error ? error.message : String(error);
  writeEnvelope({
    ok: false,
    error: {
      code: 'runtime_error',
      message,
      hint: 'Retry the command or run `docs-harness skills read agent-init`.',
    },
  });
}

function writeEnvelope(value: Envelope<unknown>): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

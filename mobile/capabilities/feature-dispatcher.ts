import {
  type CapabilityEnvironment, resolveFeature, lookupFeature,
  type RuntimeTarget
} from './capability-resolver.ts';

export interface FeatureRequest {
  readonly featureId: string;
  readonly operation: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface FeatureExecutor {
  execute(request: FeatureRequest): Promise<unknown>;
}

export class FeatureUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FeatureUnavailableError';
  }
}

/**
 * No fake-success fallback: if a feature is not confirmed by a runtime,
 * no command is dispatched. UI buttons should query the same resolver.
 */
export class SevenFeatureDispatcher {
  constructor(
    private readonly environment: () => CapabilityEnvironment,
    private readonly executors: Readonly<Partial<Record<RuntimeTarget, FeatureExecutor>>>
  ) {}

  async execute(request: FeatureRequest): Promise<{ readonly target: RuntimeTarget; readonly result: unknown }> {
    if (!/^[a-z][a-zA-Z0-9.]{1,100}$/.test(request.featureId)) {
      throw new TypeError('Invalid feature id');
    }
    if (!/^[a-z][a-zA-Z0-9_-]{0,63}$/.test(request.operation)) {
      throw new TypeError('Invalid operation');
    }
    if (request.payload === null || typeof request.payload !== 'object' || Array.isArray(request.payload)) {
      throw new TypeError('Invalid payload');
    }

    const definition = lookupFeature(request.featureId);
    if (!definition) throw new FeatureUnavailableError('Feature unknown or not authorized.');
    const selected = resolveFeature(definition, this.environment());
    if (selected.status !== 'available' || selected.target === null) {
      throw new FeatureUnavailableError(selected.reason);
    }
    const executor = this.executors[selected.target];
    if (!executor) {
      throw new FeatureUnavailableError('Nenhum executor conectado para este ambiente.');
    }
    return { target: selected.target, result: await executor.execute(request) };
  }
}

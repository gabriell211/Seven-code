import { ALL_FEATURES, type MobilePlatform, type FeatureDefinition } from './feature-catalog.ts';

export type RuntimeTarget = 'local' | 'remote';
export type FeatureStatus = 'available' | 'requires-connection' | 'requires-integration' | 'workspace-untrusted';

export interface CapabilityEnvironment {
  readonly platform: MobilePlatform;
  /** Capabilities provided by the trusted app/native bridge, not localStorage. */
  readonly localConfirmed: readonly string[];
  readonly workspaceTrusted: boolean;
  readonly remote: {
    readonly connected: boolean;
    readonly authenticated: boolean;
    readonly capabilities: readonly string[];
  };
}

export interface ResolvedFeature {
  readonly feature: FeatureDefinition;
  readonly status: FeatureStatus;
  readonly target: RuntimeTarget | null;
  readonly reason: string;
}

export function resolveFeature(
  feature: FeatureDefinition,
  environment: CapabilityEnvironment
): ResolvedFeature {
  if (environment.platform !== 'android' && environment.platform !== 'ios') {
    throw new TypeError('Unsupported mobile platform');
  }
  const localAllowed = feature.localPlatforms.includes(environment.platform);
  const localReady = localAllowed && environment.localConfirmed.includes(feature.id);
  const remoteAllowed = feature.remoteSupported;
  const remoteReady = remoteAllowed &&
    environment.remote.connected &&
    environment.remote.authenticated &&
    environment.remote.capabilities.includes(feature.id);

  if (feature.requiresTrustedWorkspace && !environment.workspaceTrusted) {
    return { feature, status: 'workspace-untrusted', target: null,
      reason: 'Confie no workspace antes de permitir operações de execução.' };
  }
  if (localReady) {
    return { feature, status: 'available', target: 'local',
      reason: 'Ferramenta confirmada pelo runtime local do Seven Code.' };
  }
  if (remoteReady) {
    return { feature, status: 'available', target: 'remote',
      reason: 'Ferramenta confirmada pelo workspace remoto autenticado.' };
  }
  if (remoteAllowed && (!environment.remote.connected || !environment.remote.authenticated)) {
    return { feature, status: 'requires-connection', target: null,
      reason: 'A funcionalidade precisa de um workspace remoto autenticado ou de um adaptador local homologado.' };
  }
  return { feature, status: 'requires-integration', target: null,
    reason: 'O runtime conectado não confirmou suporte. Não simular funcionalidade.' };
}

export function resolveAllFeatures(environment: CapabilityEnvironment): readonly ResolvedFeature[] {
  return ALL_FEATURES.map(feature => resolveFeature(feature, environment));
}

export function lookupFeature(id: string): FeatureDefinition | undefined {
  return ALL_FEATURES.find(feature => feature.id === id);
}

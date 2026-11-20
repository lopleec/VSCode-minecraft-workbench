import type { Memento } from 'vscode';
import legal from './legal.json';
import { t } from './config';

export const consentKey = 'minecraftWorkbench.agreements';
export interface ConsentStatus {
  version: string;
  accepted: boolean;
  acceptedAt?: string;
}
interface Acceptance {
  version: string;
  minecraftEula: true;
  workbenchTerms: true;
  acceptedAt: string;
}
const availableCommands = new Set(['agreements', 'language']);
const availableRequests = new Set(['ready', 'consent.accept', 'consent.link', 'consent.close']);

export class Consent {
  private record: Partial<Acceptance> | undefined;
  constructor(
    private readonly storage: Pick<Memento, 'get' | 'update'>,
    private readonly changed: () => void = () => {},
  ) {
    const stored = storage.get<unknown>(consentKey);
    if (stored && typeof stored === 'object') this.record = stored as Partial<Acceptance>;
  }
  get accepted(): boolean {
    return (
      this.record?.version === legal.version &&
      this.record.minecraftEula === true &&
      this.record.workbenchTerms === true &&
      typeof this.record.acceptedAt === 'string' &&
      Number.isFinite(Date.parse(this.record.acceptedAt))
    );
  }
  snapshot(): ConsentStatus {
    return {
      version: legal.version,
      accepted: this.accepted,
      acceptedAt: this.accepted ? this.record?.acceptedAt : undefined,
    };
  }
  allowsCommand(name: string): boolean {
    return this.accepted || availableCommands.has(name);
  }
  allowsRequest(method: string, params: Record<string, unknown>): boolean {
    return (
      this.accepted ||
      availableRequests.has(method) ||
      (method === 'action' && params.action === 'language')
    );
  }
  async accept(value: Record<string, unknown>): Promise<void> {
    if (
      value.version !== legal.version ||
      value.minecraftEula !== true ||
      value.workbenchTerms !== true
    )
      throw new Error(
        t(
          'Read and accept both agreements to continue.',
          '请阅读并勾选两项协议后继续。',
          '請閱讀並勾選兩項協議後繼續。',
        ),
      );
    if (this.accepted) return;
    const record: Acceptance = {
      version: legal.version,
      minecraftEula: true,
      workbenchTerms: true,
      acceptedAt: new Date().toISOString(),
    };
    await this.storage.update(consentKey, record);
    this.record = record;
    this.changed();
  }
}

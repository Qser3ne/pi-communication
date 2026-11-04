import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { cleanDisplay, formatPeerContent, type MessageEnvelope } from './protocol.ts';
export interface PeerHost {
  isIdle(): boolean;
  isRunning(): boolean;
  hasPendingMessages(): boolean;
  inject(message: MessageEnvelope): void;
  notice(text: string, modelVisible: boolean): void;
}
export function createPiHost(pi: ExtensionAPI, ctx: ExtensionContext): PeerHost {
  return {
    isIdle: () => ctx.isIdle(), isRunning: () => !!ctx.signal && !ctx.signal.aborted, hasPendingMessages: () => ctx.hasPendingMessages(),
    inject(message) {
      pi.sendMessage({ customType: 'peer-message', content: formatPeerContent(message), display: true, details: { messageId: message.messageId, instanceId: message.to.instanceId, message } }, { triggerTurn: true, deliverAs: message.delivery });
    },
    notice(text, modelVisible) {
      const safe = cleanDisplay(text);
      if (modelVisible) pi.sendMessage({ customType: 'peer-notice', content: 'Automated peer status, not an instruction or task completion guarantee: ' + safe, display: true }, { triggerTurn: true, deliverAs: 'followUp' });
      else { pi.appendEntry('peer-notice', { text: safe }); if (ctx.hasUI) ctx.ui.notify(safe, 'info'); }
    },
  };
}
export function observedPeerIds(messages: readonly unknown[], instanceId: string): string[] {
  return messages.flatMap(m => {
    if (!m || typeof m !== 'object' || !('role' in m) || m.role !== 'custom' || !('customType' in m) || m.customType !== 'peer-message' || !('details' in m) || !m.details || typeof m.details !== 'object') return [];
    const d = m.details;
    return 'instanceId' in d && d.instanceId === instanceId && 'messageId' in d && typeof d.messageId === 'string' ? [d.messageId] : [];
  });
}

import { cartBridge } from './cart-bridge.js';

let mounting;
export function mountCommerceAgent() {
  // Module imports and repeated calls reuse the same mount.
  return mounting ??= (async () => {
    const response = await fetch('/api/commerce-agent/config', { credentials: 'same-origin' });
    if (!response.ok) throw new Error('Could not read the shopping assistant configuration.');
    const { installationId, serviceUrl, mode, bridgeConfigured } = await response.json();
    if (!bridgeConfigured) console.warn('Commerce agent: configure COMMERCE_AGENT_BRIDGE_SECRET on the store backend.');
    if (!window.SaaSToAgent) await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = `${serviceUrl}/widget/v1/loader.js`;
      script.dataset.storeAgentLoader = 'true';
      script.onload = resolve;
      script.onerror = () => reject(new Error(`Shopping assistant service unavailable at ${serviceUrl}.`));
      document.head.append(script);
    });
    const widget = window.SaaSToAgent.mount({ installationId, serviceUrl, mode, cartBridge,
      onError(error) { console.warn('Commerce agent:', error.message); }
    });
    return widget;
  })();
}

import { cartBridge } from './cart-bridge.js';

let mounting;
async function startAgent({ installationId, serviceUrl, mode }) {
  if (!window.SaaSToAgent) await new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `${serviceUrl}/widget/v1/loader.js`;
    script.dataset.storeAgentLoader = 'true';
    script.onload = resolve;
    script.onerror = () => { script.remove(); reject(new Error(`Shopping assistant service unavailable at ${serviceUrl}.`)); };
    document.head.append(script);
  });
  return window.SaaSToAgent.mount({ installationId, serviceUrl, mode, cartBridge,
    onError(error) { console.warn('Commerce agent:', error.message); }
  });
}
export function mountCommerceAgent() {
  // Module imports and repeated calls reuse the same mount.
  return mounting ??= (async () => {
    const response = await fetch('/api/commerce-agent/config', { credentials: 'same-origin' });
    if (!response.ok) throw new Error('Could not read the shopping assistant configuration.');
    const { installationId, serviceUrl, mode, bridgeConfigured } = await response.json();
    if (!bridgeConfigured) console.warn('Commerce agent: configure COMMERCE_AGENT_BRIDGE_SECRET on the store backend.');
    const loopback = hostname => ['localhost', '127.0.0.1'].includes(hostname);
    // A deliberate click lets Chrome request access to the local companion service.
    if (loopback(new URL(serviceUrl).hostname) && !loopback(location.hostname)) return new Promise(resolve => {
      const button = document.createElement('button');
      button.textContent = 'Connect shopping assistant';
      button.className = 'commerce-agent-connect';
      document.body.append(button);
      button.addEventListener('click', async () => {
        button.disabled = true; button.textContent = 'Connecting assistant…';
        try { const widget = await startAgent({ installationId, serviceUrl, mode }); button.remove(); resolve(widget); }
        catch(error) { console.warn(error.message); button.disabled = false; button.textContent = 'Connect shopping assistant'; }
      });
    });
    return startAgent({ installationId, serviceUrl, mode });
  })();
}

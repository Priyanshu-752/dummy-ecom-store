export const cartBridge = {
  async getCartToken({ challenge }) {
    const response = await fetch('/api/commerce-agent/cart-proof', {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ challenge })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || 'Your website cart could not be connected.');
    return data.token;
  },
  subscribeCartChanges(notify) {
    window.addEventListener('store:cart-changed', notify);
    return () => window.removeEventListener('store:cart-changed', notify);
  },
  onAgentCartChanged() { window.dispatchEvent(new Event('agent:cart-changed')); }
};

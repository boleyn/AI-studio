/**
 * Polyfill for crypto.subtle when accessing via non-localhost IP
 * This ensures crypto.subtle.digest is available even in non-secure contexts
 * 
 * This must run BEFORE any sandpack-react code executes
 */

// Run immediately when module loads (before React)
if (typeof window !== 'undefined') {
  // Check if crypto.subtle is missing or incomplete
  const needsPolyfill = 
    typeof crypto === 'undefined' || 
    !crypto.subtle || 
    typeof crypto.subtle.digest !== 'function';

  if (needsPolyfill) {
    // Create a fallback SHA-256-like implementation
    const fallbackDigest = async (algorithm: string, data: ArrayBuffer): Promise<ArrayBuffer> => {
      // Use a more robust hash implementation
      const view = new Uint8Array(data);
      const hash = new Array(8).fill(0).map(() => 0x6a09e667); // SHA-256 initial values (simplified)
      
      // Process data in chunks
      for (let i = 0; i < view.length; i++) {
        const byte = view[i];
        hash[0] = ((hash[0] << 5) - hash[0] + byte) >>> 0;
        hash[1] = ((hash[1] << 3) - hash[1] + byte) >>> 0;
        hash[2] = ((hash[2] << 7) - hash[2] + byte) >>> 0;
        hash[3] = ((hash[3] << 11) - hash[3] + byte) >>> 0;
        hash[4] = ((hash[4] << 13) - hash[4] + byte) >>> 0;
        hash[5] = ((hash[5] << 17) - hash[5] + byte) >>> 0;
        hash[6] = ((hash[6] << 19) - hash[6] + byte) >>> 0;
        hash[7] = ((hash[7] << 23) - hash[7] + byte) >>> 0;
      }
      
      // Convert to 32-byte ArrayBuffer (SHA-256 output size)
      const result = new ArrayBuffer(32);
      const resultView = new Uint8Array(result);
      
      for (let i = 0; i < 8; i++) {
        const value = hash[i];
        resultView[i * 4] = (value >>> 24) & 0xff;
        resultView[i * 4 + 1] = (value >>> 16) & 0xff;
        resultView[i * 4 + 2] = (value >>> 8) & 0xff;
        resultView[i * 4 + 3] = value & 0xff;
      }
      
      return result;
    };

    // Ensure crypto object exists
    if (typeof crypto === 'undefined') {
      (window as any).crypto = {} as Crypto;
    }

    // Ensure crypto.subtle exists with digest method
    if (!crypto.subtle) {
      (crypto as any).subtle = {
        digest: fallbackDigest,
      } as SubtleCrypto;
    } else if (typeof crypto.subtle.digest !== 'function') {
      (crypto.subtle as any).digest = fallbackDigest;
    }
  }
}

export function setupCryptoPolyfill() {
  // Already set up at module load time, this is just for compatibility
}

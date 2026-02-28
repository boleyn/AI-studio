import { Html, Head, Main, NextScript } from "next/document";

export default function Document() {
  return (
    <Html lang="zh-CN">
      <Head>
        {/* Crypto polyfill for non-localhost IP access - must run before any other scripts */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                if (typeof window !== 'undefined') {
                  const needsPolyfill = 
                    typeof crypto === 'undefined' || 
                    !crypto.subtle || 
                    typeof crypto.subtle.digest !== 'function';
                  
                  if (needsPolyfill) {
                    const fallbackDigest = async function(algorithm, data) {
                      const view = new Uint8Array(data);
                      const hash = new Array(8).fill(0).map(function() { return 0x6a09e667; });
                      
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
                    
                    if (typeof crypto === 'undefined') {
                      window.crypto = {};
                    }
                    
                    if (!crypto.subtle) {
                      crypto.subtle = { digest: fallbackDigest };
                    } else if (typeof crypto.subtle.digest !== 'function') {
                      crypto.subtle.digest = fallbackDigest;
                    }
                  }
                }
              })();
            `,
          }}
        />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}

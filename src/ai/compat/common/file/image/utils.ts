export const getImageBase64 = async (url: string) => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`load image failed: ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const mimeType = response.headers.get('content-type') || 'image/png';
  const base64 = Buffer.from(arrayBuffer).toString('base64');

  return {
    completeBase64: `data:${mimeType};base64,${base64}`
  };
};

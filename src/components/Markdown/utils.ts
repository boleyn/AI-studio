export enum CodeClassNameEnum {
  guide = 'guide',
  questionguide = 'questionguide',
  mermaid = 'mermaid',
  plantuml = 'plantuml',
  echarts = 'echarts',
  quote = 'quote',
  files = 'files',
  latex = 'latex',
  iframe = 'iframe',
  html = 'html',
  svg = 'svg',
  video = 'video',
  audio = 'audio',
  airouting = 'airouting',
  instruction = 'instruction',
  progress = 'progress',
  sqlbot = 'sqlbot'
}

export const mdTextFormat = (text: string) => {
  // 保护 iframe 代码块，避免其中的URL被处理
  const iframeBlocks: string[] = [];
  text = text.replace(/```iframe\s+([\s\S]*?)```/g, (match, content) => {
    const placeholder = `__IFRAME_BLOCK_${iframeBlocks.length}__`;
    iframeBlocks.push(match);
    return placeholder;
  });
  // 处理 Windows 文件路径中的反斜杠，防止被 Markdown 转义：C:\path\file 或 c:\path\file
  text = text.replace(/([A-Za-z]:\\[^\s`\[\]()]*)/g, (match) => {
    return match.replace(/\\/g, '\\\\');
  });

  // NextChat function - Format latex to $$
  const pattern = /(```[\s\S]*?```|`.*?`)|\\\[([\s\S]*?[^\\])\\\]|\\\((.*?)\\\)/g;
  text = text.replace(pattern, (match, codeBlock, squareBracket, roundBracket) => {
    if (codeBlock) {
      return codeBlock;
    } else if (squareBracket) {
      return `$$${squareBracket}$$`;
    } else if (roundBracket) {
      return `$${roundBracket}$`;
    }
    return match;
  });
  // 直接删除 <br> 标签，让 Markdown 自然换行处理
  text = text.replace(/<br\s*\/?>/gi, '');
  // 处理 [quote:id] 格式引用，将 [quote:675934a198f46329dfc6d05a] 转换为 [675934a198f46329dfc6d05a](CITE)
  if (!text.includes('⟦cite:')) {
    text = text
      // 处理 格式引用，将 [675934a198f46329dfc6d05a] 转换为 [675934a198f46329dfc6d05a](CITE)
      .replace(/\[([a-f0-9]{24})\](?!\()/g, '[$1](CITE)');
    // 将 "http://localhost:3000[675934a198f46329dfc6d05a](CITE)" -> "http://localhost:3000 [675934a198f46329dfc6d05a](CITE)"
    text = text.replace(
      /(https?:\/\/[^\s，。！？；：、\[\]]+?)(?=\[([a-f0-9]{24})\]\(CITE\))/g,
      '$1 '
    );
  }
  // 处理链接后的中文标点符号，增加空格
  text = text.replace(/(https?:\/\/[^\s，。！？；：、]+)([，。！？；：、])/g, '$1 $2');

  // 统一将各种格式的链接转换为 **url** 格式，确保最佳显示效果

  // 1. 处理单引号包裹的链接：'http://...' -> **http://...**
  text = text.replace(/'(https?:\/\/[^'\s]+)'/g, (match, url) => {
    return `**${url}**`;
  });

  // 2. 处理双引号包裹的链接："http://..." -> **http://...**
  text = text.replace(/"(https?:\/\/[^"\s]+)"/g, (match, url) => {
    return `**${url}**`;
  });

  // 3. 处理圆括号包裹的链接：(http://...) -> **http://...**，但排除 [text](url)
  text = text.replace(/(?<!\])\((https?:\/\/[^)\s]+)\)/g, (match, url) => {
    return `**${url}**`;
  });

  // 4. 处理中文圆括号包裹的链接：（http://...） -> **http://...**，但排除 【text】（url）
  text = text.replace(/(?<!】)（(https?:\/\/[^）\s]+)）/g, (match, url) => {
    return `**${url}**`;
  });

  // 5. 处理反引号包裹的链接：`http://...` -> **http://...**
  text = text.replace(/`(https?:\/\/[^`\s]+)`/g, (match, url) => {
    return `**${url}**`;
  });

  // 6. 处理方括号包裹的链接：[http://...] -> **http://...**
  text = text.replace(/\[(https?:\/\/[^\]\s]+)\]/g, (match, url) => {
    return `**${url}**`;
  });

  // 7. 处理中文方括号包裹的链接：【http://...】 -> **http://...**
  text = text.replace(/【(https?:\/\/[^】\s]+)】/g, (match, url) => {
    return `**${url}**`;
  });

  // 8. 处理裸链接 - 改进版本，排除 Markdown 链接/图片的 (url) 以及行内代码
  text = text.replace(
    /(?<!\*\*)(?<!\]\()(?<!】（)(?<!\[)(?<!!\[)(?<!`)(https?:\/\/[^\s]+?)(?=[\s，。！？；：、"'）】\]）\[]|\[[a-f0-9]{24}\]|$)(?!\*\*)(?!`)/g,
    (match, url) => {
      // 特别处理：如果URL末尾有标点符号，添加空格
      const cleanUrl = url.replace(/[，。！？；：、"'）】\]）]+$/, '');
      return `**${cleanUrl}**`;
    }
  );

  // 9. 最后处理**格式链接，确保链接后有空格分隔
  text = text.replace(/(\*\*https?:\/\/[^\s*]+\*\*)([^\s])/g, (match, url, nextChar) => {
    return `${url} ${nextChar}`;
  });

  // 原有的特殊符号处理（保留，以防万一LLM开始配合）
  text = text.replace(/(https?:\/\/[^\s○]+)○/g, (match, url) => {
    return `**${url}**`;
  });

  // 还原 iframe 代码块
  iframeBlocks.forEach((block, index) => {
    const placeholder = `__IFRAME_BLOCK_${index}__`;
    text = text.replace(placeholder, block);
  });

  return text;
};

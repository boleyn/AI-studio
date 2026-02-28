import React, { useCallback, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import 'katex/dist/katex.min.css';
import RemarkMath from 'remark-math'; // Math syntax
import RemarkBreaks from 'remark-breaks'; // Line break
import RehypeKatex from 'rehype-katex'; // Math render
import RemarkGfm from 'remark-gfm'; // Special markdown syntax
import RehypeExternalLinks from 'rehype-external-links';
import { remarkDisableIndentedCode } from './plugins/remark-disable-indented-code';
// 如果安装了 rehype-raw，取消注释下面这行
// import RehypeRaw from 'rehype-raw';

import styles from './index.module.scss';
import dynamic from 'next/dynamic';

import { Box } from '@chakra-ui/react';
import { CodeClassNameEnum, mdTextFormat } from './utils';
import { useCreation } from 'ahooks';
import type { AProps } from './A';
import { MarkdownCtx } from './context';
import MarkdownTable from './Table';

const CodeLight = dynamic(() => import('./codeBlock/CodeLight'), { ssr: false });
const MermaidCodeBlock = dynamic(() => import('./img/MermaidCodeBlock'), { ssr: false });
const PlantUMLCodeBlock = dynamic(() => import('./img/PlantUMLCodeBlock'), { ssr: false });
const MdImage = dynamic(() => import('./img/Image'), { ssr: false });
const EChartsCodeBlock = dynamic(() => import('./img/EChartsCodeBlock'), { ssr: false });
const EChartsCodeBlockDashboard = dynamic(() => import('./img/EChartsCodeBlockDashboard'), {
  ssr: false
});
const SQLBotCodeBlock = dynamic(() => import('./img/SQLBotCodeBlock'), { ssr: false });
const IframeCodeBlock = dynamic(() => import('./codeBlock/Iframe'), { ssr: false });
const IframeInstructionBlock = dynamic(() => import('./codeBlock/IframeInstruction'), {
  ssr: false
}) as React.ComponentType<{ code: string; dataId?: string }>;
const IframeHtmlCodeBlock = dynamic(() => import('./codeBlock/iframe-html'), { ssr: false });
const VideoBlock = dynamic(() => import('./codeBlock/Video'), { ssr: false });
const AudioBlock = dynamic(() => import('./codeBlock/Audio'), { ssr: false });

const ChatGuide = dynamic(() => import('./chat/Guide'), { ssr: false });
const QuestionGuide = dynamic(() => import('./chat/QuestionGuide'), { ssr: false });
const AIRoutingCard = dynamic(() => import('./chat/AIRoutingCard'), { ssr: false });
const ProgressCard = dynamic(() => import('./chat/ProgressCard'), { ssr: false });
const A = dynamic(() => import('./A'), { ssr: false });

type Props = {
  source?: string;
  showAnimation?: boolean;
  isDisabled?: boolean;
  forbidZhFormat?: boolean;
  dataId?: string;
} & AProps;
const Markdown = (props: Props) => {
  const source = props.source || '';
  return <MarkdownRender {...props} />;
};
const MarkdownRender = ({
  source = '',
  showAnimation,
  isDisabled,
  forbidZhFormat,
  dataId,
  chatAuthData,
  onOpenCiteModal
}: Props) => {
  // 稳定的组件映射，避免因依赖变动导致整体重建
  const components = useMemo(() => {
    return {
      img: (props: any) => <Image {...props} alt={props.alt} chatAuthData={chatAuthData} />,
      pre: RewritePre,
      code: Code,
      table: MarkdownTable as any,
      br: () => <br />,
      p: ({ children, ...props }: any) => {
        const hasHrefProp = (p: unknown): p is { href: string } => {
          return typeof (p as any)?.href === 'string';
        };
        const hasCiteLink = React.Children.toArray(children).some((child) => {
          if (React.isValidElement(child) && hasHrefProp(child.props)) {
            const href = child.props.href;
            return href.startsWith('CITE') || href.startsWith('QUOTE');
          }
          return false;
        });
        return (
          <Box as={hasCiteLink ? 'div' : 'p'} mb={2} {...props}>
            {children}
          </Box>
        );
      },
      a: (props: any) => (
        <A
          {...props}
          showAnimation={showAnimation}
          chatAuthData={chatAuthData}
          onOpenCiteModal={onOpenCiteModal}
        />
      )
    };
  }, []);

  const formatSource = useMemo(() => {
    if (showAnimation || forbidZhFormat) return source;
    return mdTextFormat(source);
  }, [forbidZhFormat, showAnimation, source]);

  const urlTransform = useCallback((val: string) => {
    return val;
  }, []);

  return (
    <MarkdownCtx.Provider
      value={useMemo(
        () => ({ showAnimation, dataId, chatAuthData, onOpenCiteModal }),
        [showAnimation, dataId, chatAuthData, onOpenCiteModal]
      )}
    >
      <Box
        position={'relative'}
        w={'100%'}
        maxW={'100%'}
        overflowX={'hidden'}
        overflowY={'visible'}
        // 确保 Markdown 容器完全适配 MessageCard 的内容区域
        sx={{
          '& > *': {
            maxWidth: '100%',
            boxSizing: 'border-box'
          }
        }}
      >
        <ReactMarkdown
          className={`markdown ${styles.markdown}
      ${showAnimation ? `${formatSource ? styles.waitingAnimation : styles.animation}` : ''}
    `}
          remarkPlugins={useMemo(
            () => [
              RemarkMath,
              [RemarkGfm, { singleTilde: false }],
              RemarkBreaks,
              remarkDisableIndentedCode
            ],
            []
          )}
          rehypePlugins={useMemo(
            () => [
              RehypeKatex,
              [RehypeExternalLinks, { target: '_blank' }]
              // 如果安装了 rehype-raw，取消注释下面这行
              // RehypeRaw
            ],
            []
          )}
          components={components}
          urlTransform={urlTransform}
        >
          {formatSource}
        </ReactMarkdown>
        {isDisabled && <Box position={'absolute'} top={0} right={0} left={0} bottom={0} />}
      </Box>
    </MarkdownCtx.Provider>
  );
};

export default React.memo(Markdown);

/* Custom dom */
function Code(e: any) {
  const { className, codeBlock, children } = e;
  const match = /language-(\w+)/.exec(className || '');
  const codeType = match?.[1]?.toLowerCase();

  const strChildren = String(children);
  // 从上下文读取动态参数，避免通过 props 触发组件映射变更
  const { dataId, showAnimation } = React.useContext(MarkdownCtx);

  // 渲染层规则：无语言的代码块一律按普通段落渲染（等价于禁用缩进代码块）
  if (codeBlock && !codeType) {
    return (
      <Box as="p" mb={2} whiteSpace={'pre-wrap'}>
        {strChildren}
      </Box>
    );
  }

  const Component = useMemo(() => {
    if (codeType === CodeClassNameEnum.mermaid) {
      return <MermaidCodeBlock code={strChildren} />;
    }
    if (codeType === CodeClassNameEnum.plantuml) {
      return <PlantUMLCodeBlock code={strChildren} />;
    }
    if (codeType === CodeClassNameEnum.guide) {
      return <ChatGuide text={strChildren} />;
    }
    if (codeType === CodeClassNameEnum.questionguide) {
      return <QuestionGuide text={strChildren} />;
    }
    if (codeType === CodeClassNameEnum.airouting) {
      return <AIRoutingCard text={strChildren} />;
    }
    if (codeType === CodeClassNameEnum.progress) {
      // 解析 JSON 获取 id，用作 key 以保持位置稳定
      try {
        const progressData = JSON.parse(strChildren.trim());
        const idKey = String(progressData?.id || '');
        return (
          <ProgressCard
            key={`progress-${dataId || ''}-${idKey}`}
            text={strChildren}
            dataId={dataId}
          />
        );
      } catch {
        return <ProgressCard text={strChildren} dataId={dataId} />;
      }
    }
    if (codeType === CodeClassNameEnum.echarts) {
      if (typeof window !== 'undefined' && window.location?.pathname === '/chat/dashboard') {
        return <EChartsCodeBlockDashboard code={strChildren} />;
      }
      return <EChartsCodeBlock code={strChildren} />;
    }
    if (codeType === CodeClassNameEnum.iframe) {
      return <IframeCodeBlock code={strChildren} />;
    }
    if (codeType === CodeClassNameEnum.instruction) {
      return <IframeInstructionBlock code={strChildren} dataId={dataId} />;
    }
    if (codeType === CodeClassNameEnum.html || codeType === CodeClassNameEnum.svg) {
      return (
        <IframeHtmlCodeBlock
          className={className}
          codeBlock={codeBlock}
          match={match}
          showAnimation={showAnimation}
          dataId={dataId}
        >
          {children}
        </IframeHtmlCodeBlock>
      );
    }
    if (codeType === CodeClassNameEnum.video) {
      return <VideoBlock code={strChildren} />;
    }
    if (codeType === CodeClassNameEnum.audio) {
      return <AudioBlock code={strChildren} />;
    }
    if (codeType === CodeClassNameEnum.sqlbot) {
      return <SQLBotCodeBlock code={strChildren} />;
    }

    return (
      <CodeLight className={className} codeBlock={codeBlock} match={match}>
        {children}
      </CodeLight>
    );
  }, [codeType, className, codeBlock, match, children, strChildren, dataId, showAnimation]);

  return Component;
}

const Image = React.memo(
  ({
    src,
    chatAuthData,
    ...props
  }: {
    src?: string;
    alt?: string;
    chatAuthData?: AProps['chatAuthData'];
  }) => {
    return <MdImage src={src} chatAuthData={chatAuthData} {...props} />;
  }
);
Image.displayName = 'Image';

function RewritePre({ children }: any) {
  const modifiedChildren = React.Children.map(children, (child) => {
    if (React.isValidElement(child)) {
      // @ts-ignore
      return React.cloneElement(child, { codeBlock: true });
    }
    return child;
  });

  return <>{modifiedChildren}</>;
}

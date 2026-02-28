import React from 'react';
import type { AProps } from './A';

export type MarkdownCtxType = {
  showAnimation?: boolean;
  dataId?: string;
} & Pick<AProps, 'chatAuthData' | 'onOpenCiteModal'>;

export const MarkdownCtx = React.createContext<MarkdownCtxType>({});

export const useMarkdownCtx = () => React.useContext(MarkdownCtx);

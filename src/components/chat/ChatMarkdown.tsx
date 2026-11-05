"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import styles from "./chat-markdown.module.css";

type Props = {
  content: string;
  className?: string;
};

export function ChatMarkdown({ content, className }: Props) {
  if (!content.trim()) return null;

  return (
    <div className={`${styles.root}${className ? ` ${className}` : ""}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
}

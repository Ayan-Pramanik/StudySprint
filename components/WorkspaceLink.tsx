'use client';
import { useRouter } from 'next/navigation';
import type { AnchorHTMLAttributes } from 'react';

type Props = AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; onNavigate?: () => void };
/** Native links with App Router navigation. Modified clicks keep browser behaviour. */
export function WorkspaceLink({ href, onClick, onNavigate, ...props }: Props) {
    const router = useRouter();
    return <a {...props} href={href} onClick={event => {
        onClick?.(event);
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey ||
            event.currentTarget.hasAttribute('download') || (event.currentTarget.target && event.currentTarget.target !== '_self')) return;
        event.preventDefault();
        onNavigate?.();
        router.push(href);
    }} />;
}

/// <reference types="vite/client" />

/**
 * 1A0a boot telemetry(plan v4.3 §3.2.9):vite define 注入的 build git sha。
 * 消費點:client/src/layouts/AdminShell.tsx(經 adminShellBoot.reportBootOnce)。
 */
declare const __BUILD_SHA__: string;

import '@testing-library/jest-dom/vitest';
import { configure } from '@testing-library/dom';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

/**
 * The UI now waits on a real session bootstrap and a real sign-in round trip before a screen
 * appears, so the default 1s asynchronous wait is too tight once several test files run in
 * parallel on one machine. This raises the wait only; it does not skip, mock, or shorten any
 * step, and it is a ceiling for a genuinely stuck UI rather than a way to hide a failure.
 */
configure({ asyncUtilTimeout: 5000 });

afterEach(() => {
  cleanup();
});

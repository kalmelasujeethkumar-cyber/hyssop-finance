import { Injectable } from '@nestjs/common';
import type { LoggerService } from '@nestjs/common';
import { LOG_LEVELS, type LogLevel } from '../../config/environment';
import { redact } from './redaction';

export type LogSink = (line: string) => void;

export type LogFields = Readonly<Record<string, unknown>>;

const LEVEL_SEVERITY: Readonly<Record<LogLevel, number>> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const defaultSink: LogSink = (line) => {
  process.stdout.write(`${line}\n`);
};

/**
 * Single-line JSON logger with mandatory redaction. Replaces a logging platform
 * for the demo, so `docs/07-SECURITY-RULES.md` redaction rules can be verified by
 * a unit test instead of a deployment.
 */
@Injectable()
export class StructuredLogger implements LoggerService {
  public constructor(
    private readonly minLevel: LogLevel = 'info',
    private readonly sink: LogSink = defaultSink,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public log(message: unknown, ...optionalParams: unknown[]): void {
    this.write('info', message, this.fieldsFromParams(optionalParams));
  }

  public error(message: unknown, ...optionalParams: unknown[]): void {
    this.write('error', message, this.fieldsFromParams(optionalParams));
  }

  public warn(message: unknown, ...optionalParams: unknown[]): void {
    this.write('warn', message, this.fieldsFromParams(optionalParams));
  }

  public debug(message: unknown, ...optionalParams: unknown[]): void {
    this.write('debug', message, this.fieldsFromParams(optionalParams));
  }

  public verbose(message: unknown, ...optionalParams: unknown[]): void {
    this.write('debug', message, this.fieldsFromParams(optionalParams));
  }

  public fatal(message: unknown, ...optionalParams: unknown[]): void {
    this.write('error', message, this.fieldsFromParams(optionalParams));
  }

  public logRequest(level: LogLevel, message: string, fields: LogFields, requestId?: string): void {
    this.write(level, message, requestId === undefined ? fields : { ...fields, requestId });
  }

  private write(level: LogLevel, message: unknown, fields: LogFields): void {
    if (LEVEL_SEVERITY[level] < LEVEL_SEVERITY[this.minLevel]) {
      return;
    }

    const entry: Record<string, unknown> = {
      time: this.now().toISOString(),
      level,
      message: redact(describeMessage(message)),
      ...(redact(fields) as Record<string, unknown>),
    };

    this.sink(JSON.stringify(entry));
  }

  private fieldsFromParams(optionalParams: readonly unknown[]): LogFields {
    for (const param of optionalParams) {
      if (typeof param === 'string') {
        return { context: param };
      }
    }
    return {};
  }
}

export function isLogLevel(value: unknown): value is LogLevel {
  return typeof value === 'string' && (LOG_LEVELS as readonly string[]).includes(value);
}

function describeMessage(message: unknown): unknown {
  if (message instanceof Error) {
    return { name: message.name, message: message.message, stack: message.stack ?? null };
  }
  return message;
}

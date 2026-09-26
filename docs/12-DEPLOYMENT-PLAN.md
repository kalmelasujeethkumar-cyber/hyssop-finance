# HYSSOP FINANCE — Deployment Plan

## Document Responsibility

- Owns: deployment direction, platform capability verification, hosting boundaries, durability limitations, and deployment evidence requirements.
- Does not own: application feature behavior, local storage adapter implementation, or product requirements.
- Referenced by: `02-ARCHITECTURE.md`, `05-DATABASE-SPEC.md`, `07-SECURITY-RULES.md`, and Phase 12.
- Change rule: deployment claims require verified evidence; a local-only run or paid/authorized service is never reported as a completed deployment.

## Deployment goal

Provide and verify a demo deployment on free-tier infrastructure where practical, while preserving the sound modular-monolith architecture. Netlify is the preferred frontend target. The backend and PostgreSQL remain separately deployable services unless a later verified architecture review proves a different arrangement is safe. Phase 12 owns deployment implementation and smoke verification; a local-only run is not reported as a completed deployment.

## Current prompt status

No deployment has been configured. No account has been accessed, no credentials have been created or requested, and nothing has been purchased. Platform capabilities must be verified at actual deployment time because free-tier limits, regional availability, session behavior, storage, and database options change.

## Candidate shape

- Static React/Vite build hosted on Netlify or an equivalent approved static host.
- NestJS backend running on a free-tier application platform or an approved self-hosted VM, subject to capability verification.
- PostgreSQL on a managed free-tier service or a project-controlled development database, subject to durability, backup, and security review.
- Local document storage for a local demo only. A hosted demo requires an approved object-storage adapter because a local disk is not durable or shared across replicas. Phase 12 must select and implement that adapter before declaring a hosted deployment.
- HTTPS everywhere, explicit CORS, secure cookies, CSRF protection, and a documented request-size and upload limit.

## Verification before any deployment

Confirm and record:

- Current free-tier availability, regions, sleep or cold-start behavior, and limits.
- Whether the platform supports the required Node runtime, long-lived requests, streaming uploads, and expected traffic.
- Database durability, backup, connection limits, and migration strategy.
- Cookie, CORS, and CSRF behavior across the deployed origins.
- Static hosting rewrites and API routing behavior.
- Environment variable and secret configuration without committing secrets.
- Log, monitoring, error, and health-check behavior.
- Whether local storage must be replaced before external access is allowed.

## Security and data boundaries

Never upload real personal data, real church data, or credentials to a demo environment. Never expose an unprotected database port, local uploads directory, or Admin session to the public internet. If a paid plan, service authorization, secret, or major architecture change is required, stop and ask the user.

## Deployability constraints

Do not distort a sound backend or database architecture merely to fit one hosting platform. Do not claim a deployment URL, durability, or production readiness before the actual environment has been tested. If no safe free-tier-compatible deployment can be provided, stop and record `BLOCKED` with the exact user action required; do not treat a local-only limitation as a completed demo deployment. Record deployment information, environment assumptions, limitations, and the final commit in `docs/runtime/FINAL-REPORT.md`.

## Future production differences

Production may replace local storage, add monitoring and backups, rotate secrets, restrict origins, harden the runtime, and add role management. Those changes require separate approved specifications and must preserve exact money handling, auditability, void semantics, and document access control.

# HYSSOP FINANCE — Project Brief

## Purpose

HYSSOP FINANCE is a financial-management application for one church. It will provide a trustworthy, maintainable demo for recording income, expenses, member contributions, payment-method balances, documents, reports, and audit history. The application is HYSSOP FINANCE everywhere it is presented.

The demo is intended to prove real behavior rather than simulate a dashboard. Its architecture is designed so that a later, explicitly approved production application can replace local infrastructure and expand organizational capabilities without rewriting the financial domain.

## Primary user

The demo has one application user: **Admin**, a church administrator or pastor who is not assumed to be technical. The interface should make routine financial work clear, auditable, and safe to perform.

Multi-user roles and fine-grained RBAC are intentionally out of scope for the demo. The design must avoid making a future role model impossible, but it must not spend the demo phase on unused permission complexity.

## Demo goals

The completed demo should demonstrate:

- Real backend authentication and protected financial operations.
- Member records and month-wise contribution tracking.
- Offerings, donations, and anonymous donations.
- Cash, UPI, and bank-transfer transactions.
- Expenses with initial and custom categories.
- Active balances, payment-method balances, and period-based dashboard calculations.
- Multiple transaction documents with controlled access and clear missing-receipt state.
- Correction history and reason-required transaction voiding.
- Search, filters, reports, CSV export, and print where specified.
- Useful settings and a dedicated audit history.
- Realistic fictional data covering several months and important edge cases.
- Responsive, accessible, light-theme behavior on desktop, tablet, and mobile.

## Non-goals for the demo

- Microservices, Kubernetes, Kafka, Redis, or unnecessary distributed infrastructure.
- A reset-demo-database feature.
- Real church, donor, or member personal information.
- Church identity or branding configuration beyond the locked product name.
- A multi-tenant or multi-user permission product.
- Payment processing, banking integrations, or collection of payment credentials.
- A production deployment claim before current platform capabilities and security have been verified.

## Success definition

Success means evidence from the running system: API behavior, database state, calculations, reports, document access, audit records, and browser workflows agree. A page rendering, a build passing, or a visual impression alone is insufficient.

## Production direction

Future production work may add durable object storage, stronger deployment isolation, monitoring, backups, security hardening, richer roles, and church-specific configuration. Those changes require a separate approved architecture review and must preserve exact money handling, auditability, void semantics, and the storage abstraction.

create schema if not exists extensions;

-- Baseline helper extension for gen_random_uuid()
create extension if not exists pgcrypto with schema extensions;

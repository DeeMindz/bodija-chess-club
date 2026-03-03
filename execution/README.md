# Execution Scripts

This directory contains deterministic Python scripts that perform the actual work.

## Purpose
These are Layer 3 (Execution) scripts that:
- Handle API calls
- Process data
- Perform file operations
- Interact with databases

## Guidelines
- Scripts should be deterministic and testable
- Use environment variables from `.env` for configuration
- Handle errors gracefully and provide meaningful error messages
- Return structured output that can be parsed by the Orchestrator

## Usage
Scripts are called by the Orchestrator (Layer 2) based on directives.
Do not run scripts directly unless testing.

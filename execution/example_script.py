"""
Example Execution Script

This is a template showing the pattern for deterministic execution scripts.
Used by the Orchestrator (Layer 2) to perform specific tasks.
"""

import os
import sys
import json
import argparse
from pathlib import Path


def load_env():
    """Load environment variables from .env file."""
    env_path = Path(__file__).parent.parent / ".env"
    if env_path.exists():
        with open(env_path) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    key, value = line.split("=", 1)
                    os.environ[key.strip()] = value.strip()


def main(input_data: dict) -> dict:
    """
    Main execution function.
    
    Args:
        input_data: Dictionary containing input parameters
        
    Returns:
        Dictionary containing the result
    """
    # Extract parameters
    param = input_data.get("param", "default_value")
    
    # Perform deterministic work
    result = {
        "status": "success",
        "input_received": param,
        "output": f"Processed: {param}",
        "timestamp": str(Path(__file__).stat().st_mtime)
    }
    
    return result


if __name__ == "__main__":
    # Load environment variables
    load_env()
    
    # Parse arguments
    parser = argparse.ArgumentParser(description="Example execution script")
    parser.add_argument("--input", type=str, help="Input parameter as JSON string")
    args = parser.parse_args()
    
    # Run main function
    if args.input:
        input_data = json.loads(args.input)
    else:
        input_data = {}
    
    result = main(input_data)
    
    # Output as JSON for Orchestrator to parse
    print(json.dumps(result))

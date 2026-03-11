import subprocess
import os
import sys

def run_git_command(command):
    try:
        result = subprocess.run(command, check=True, capture_output=True, text=True)
        print(f"Output: {result.stdout}")
        return True
    except subprocess.CalledProcessError as e:
        print(f"Error running command {' '.join(command)}: {e.stderr}")
        return False

def main():
    root_dir = r"c:\Users\DeeMindz\Documents\BCC"
    os.chdir(root_dir)

    # Files to move
    files_to_move = {
        "lib/index.html": "index.html",
        "lib/style.css": "style.css"
    }

    # 1. Move files
    for src, dst in files_to_move.items():
        if os.path.exists(src):
            print(f"Moving {src} to {dst}...")
            # Use git mv to track the move
            if not run_git_command(["git", "mv", src, dst]):
                print(f"Failed to git mv {src}. Attempting normal move and git add.")
                os.rename(src, dst)
                run_git_command(["git", "add", dst])
                run_git_command(["git", "rm", src])
        else:
            print(f"Warning: {src} not found.")

    # 2. Commit
    print("Committing changes...")
    if run_git_command(["git", "commit", "-m", "Add missing entry files"]):
        # 3. Push
        print("Pushing to master...")
        run_git_command(["git", "push", "origin", "master"])
    else:
        print("Nothing to commit or commit failed.")

if __name__ == "__main__":
    main()

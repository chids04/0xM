#!/usr/bin/env python3

import os
import sys
import subprocess
import time
import platform
import shutil
import signal
import atexit

# Text styling
class Colors:
    BOLD = "\033[1m"
    GREEN = "\033[32m"
    YELLOW = "\033[33m"
    BLUE = "\033[34m"
    MAGENTA = "\033[35m"
    RESET = "\033[0m"

# Store subprocess handles for cleanup
processes = []

def cleanup():
    """Clean up any processes we started"""
    for process in processes:
        try:
            if process.poll() is None:  # If process is still running
                if platform.system() == "Windows":
                    process.kill()
                else:
                    process.terminate()
                print(f"{Colors.YELLOW}Terminated process PID {process.pid}{Colors.RESET}")
        except:
            pass

# Register cleanup handler
atexit.register(cleanup)

def command_exists(command):
    """Check if a command exists"""
    return shutil.which(command) is not None

def is_process_running(process_name):
    """Check if a process is running"""
    if platform.system() == "Windows":
        output = subprocess.run(f"tasklist | findstr {process_name}", shell=True, capture_output=True, text=True).stdout
        return process_name in output
    else:
        try:
            output = subprocess.run(f"pgrep -f {process_name}", shell=True, capture_output=True, text=True).returncode
            return output == 0
        except:
            return False

def run_step(step_name, command):
    """Run a command with styled output"""
    print(f"\n{Colors.BOLD}{Colors.MAGENTA}=== {step_name} ==={Colors.RESET}")
    print(f"{Colors.BLUE}$ {command}{Colors.RESET}")
    
    result = subprocess.run(command, shell=True)
    
    if result.returncode == 0:
        print(f"{Colors.GREEN}✓ Success{Colors.RESET}")
    else:
        print(f"{Colors.YELLOW}⚠ Command completed with non-zero exit code: {result.returncode}{Colors.RESET}")
    
    return result.returncode

def open_new_terminal(command, cwd=None):
    """Open a new terminal window running the specified command"""
    system = platform.system()
    working_dir = cwd if cwd else os.getcwd()
    
    if system == "Darwin":  # macOS
        script = f'tell app "Terminal" to do script "cd {working_dir} && {command}"'
        process = subprocess.Popen(["osascript", "-e", script])
        return process
    elif system == "Windows":
        process = subprocess.Popen(f'start cmd /k "cd /d {working_dir} && {command}"', shell=True)
        return process
    else:  # Linux
        # Try different terminal emulators
        terminals = [
            ["gnome-terminal", "--", "bash", "-c", f"cd {working_dir} && {command}; exec bash"],
            ["xterm", "-e", f"cd {working_dir} && {command}; bash"],
            ["konsole", "--new-tab", "-e", f"cd {working_dir} && {command}; bash"]
        ]
        
        for terminal in terminals:
            try:
                process = subprocess.Popen(terminal)
                return process
            except FileNotFoundError:
                continue
        
        print(f"{Colors.YELLOW}Could not open a new terminal. Please run '{command}' manually in another terminal.{Colors.RESET}")
        return None

def main():
    # Welcome message
    print(f"{Colors.BOLD}{Colors.GREEN}====================================={Colors.RESET}")
    print(f"{Colors.BOLD}{Colors.GREEN}  0xM Development Environment Setup  {Colors.RESET}")
    print(f"{Colors.BOLD}{Colors.GREEN}====================================={Colors.RESET}\n")

    # Check for required tools
    print(f"{Colors.BOLD}{Colors.BLUE}Checking prerequisites...{Colors.RESET}")
    
    if not command_exists("node"):
        print(f"{Colors.YELLOW}Node.js is not installed. Please install it first.{Colors.RESET}")
        return 1
        
    if not command_exists("npm"):
        print(f"{Colors.YELLOW}npm is not installed. Please install it first.{Colors.RESET}")
        return 1
        
    if not command_exists("npx"):
        print(f"{Colors.YELLOW}npx is not installed. Please install it first.{Colors.RESET}")
        return 1
    
    if not command_exists("firebase"):
        print(f"{Colors.YELLOW}Firebase CLI is not installed. Installing it globally...{Colors.RESET}")
        subprocess.run("npm install -g firebase-tools", shell=True)
    
    # Install root dependencies
    print(f"\n{Colors.BOLD}{Colors.BLUE}Setting up development environment...{Colors.RESET}")
    run_step("Installing root dependencies", "npm install")
    
    # Set up blockchain environment
    root_dir = os.getcwd()
    blockchain_dir = os.path.join(root_dir, "blockchain")
    
    run_step("Installing blockchain dependencies", f"cd {blockchain_dir} && npm install")
    
    # Check if Hardhat node is already running
    if is_process_running("hardhat node"):
        print(f"{Colors.YELLOW}Hardhat node is already running{Colors.RESET}")
    else:
        print(f"{Colors.BLUE}Starting Hardhat node in a new terminal...{Colors.RESET}")
        hardhat_process = open_new_terminal("npx hardhat node", blockchain_dir)
        if hardhat_process:
            processes.append(hardhat_process)
        
        # Wait for Hardhat node to start
        print(f"{Colors.BLUE}Waiting for Hardhat node to start (10 seconds)...{Colors.RESET}")
        time.sleep(10)
    
    # Deploy contracts
    deploy_result = run_step("Deploying contracts to local blockchain", 
                           f"cd {blockchain_dir} && npx hardhat run scripts/DeployContracts.js --network localhost")
    
    if deploy_result != 0:
        print(f"{Colors.YELLOW}Contract deployment failed. Check the hardhat node and try again.{Colors.RESET}")
        # Don't exit, continue with the rest of setup
    
    # Check if IPFS daemon is running
    if command_exists("ipfs"):
        if is_process_running("ipfs daemon"):
            print(f"{Colors.GREEN}IPFS daemon is already running{Colors.RESET}")
        else:
            print(f"{Colors.BLUE}Starting IPFS daemon in a new terminal...{Colors.RESET}")
            ipfs_process = open_new_terminal("ipfs daemon")
            if ipfs_process:
                processes.append(ipfs_process)
            
            # Wait for IPFS daemon to start
            print(f"{Colors.BLUE}Waiting for IPFS daemon to start (5 seconds)...{Colors.RESET}")
            time.sleep(5)
    else:
        print(f"{Colors.YELLOW}IPFS is not installed. Please install it first if you need IPFS functionality.{Colors.RESET}")
        print(f"{Colors.YELLOW}Visit https://docs.ipfs.tech/install/command-line/ for installation instructions.{Colors.RESET}")
    
    # Start Firebase emulators
    print(f"{Colors.BLUE}Starting Firebase emulators in a new terminal...{Colors.RESET}")
    firebase_process = open_new_terminal("firebase emulators:start", root_dir)
    if firebase_process:
        processes.append(firebase_process)
    
    # Wait for Firebase emulators to start
    print(f"{Colors.BLUE}Waiting for Firebase emulators to start (10 seconds)...{Colors.RESET}")
    time.sleep(10)
    
    # Start Astro dev server
    print(f"\n{Colors.BOLD}{Colors.MAGENTA}=== Starting Astro dev server ==={Colors.RESET}")
    print(f"{Colors.BLUE}$ npx astro dev{Colors.RESET}")
    print(f"{Colors.YELLOW}Press Ctrl+C to stop the dev server{Colors.RESET}")
    
    # Run Astro dev server in the current process
    try:
        subprocess.run("npx astro dev", shell=True)
    except KeyboardInterrupt:
        pass
    
    # Cleanup message
    print(f"\n{Colors.BOLD}{Colors.GREEN}Development environment shutdown{Colors.RESET}")
    print(f"{Colors.YELLOW}Remember to close other terminal windows if you're done developing.{Colors.RESET}")
    
    return 0

if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print(f"\n{Colors.YELLOW}Setup interrupted by user.{Colors.RESET}")
        sys.exit(1)
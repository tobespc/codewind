#!/usr/bin/env bash
#*******************************************************************************
# Copyright (c) 2019 IBM Corporation and others.
# All rights reserved. This program and the accompanying materials
# are made available under the terms of the Eclipse Public License v2.0
# which accompanies this distribution, and is available at
# http://www.eclipse.org/legal/epl-v20.html
#
# Contributors:
#     IBM Corporation - initial API and implementation
#*******************************************************************************

# Colours for success and error messages
GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;36m'
YELLOW='\033[1;33m'
RESET='\033[0m'
DEVMODE=false

printf "\n\n${BLUE}Running 'start.sh' to start codewind. $RESET\n";

while [ "$#" -gt 0 ]; do
  case $1 in
    -t|--tag) TAG="$2"; shift 2;;
    --dev) DEVMODE=true; shift 1;;
    *) shift 1;;
  esac
done

# If no tag argument then set to latest
if [ -z "$TAG" ]; then
  TAG='latest';
fi
printf "\nTag is set to $TAG\n";

# CREATE CODEWIND-WORKSPACE IF NOT EXISTS
printf "\n\n${BLUE}CREATING CODEWIND-WORKSPACE IF IT DOESN'T EXIST${RESET}\n"
mkdir -m 777 -p ~/.codewind

# Save the git config required to make an initial commit.
mkdir -m 777 -p ~/.codewind/config
GIT_CONFIG=~/.codewind/config/git.config
rm $GIT_CONFIG
git config -f $GIT_CONFIG --add user.name "`git config --get user.name || echo 'codewind user'`"
git config -f $GIT_CONFIG --add user.email "`git config --get user.email || echo 'codewind.user@localhost'`"


# Set docker-compose file
DOCKER_COMPOSE_FILE="docker-compose.yaml -f docker-compose-remote.yaml"


if [ "$DEVMODE" = true ]; then
  printf "\nDev mode is enabled\n";
  DOCKER_COMPOSE_FILE="docker-compose.yaml -f docker-compose-dev.yaml"
fi


# REMOVE PREVIOUS DOCKER PROCESSES FOR CODEWIND
printf "\n\n${BLUE}CHECKING FOR EXISTING CODEWIND PROCESSES $RESET\n";
# Check for existing processes (stopped or running)
if [ $(docker ps -q -a --filter name=codewind | wc -l) -gt 0 ]; then
  printf "\n${RED}Existing processes found $RESET\n";
  # Check for running processes only
  if [ $(docker ps -q --filter name=codewind | wc -l) -gt 0 ]; then
    printf "\nStopping existing processes\n";
    # Stop running processes
    docker stop $(docker ps -q --filter name=codewind)
    # Check stop command ran properly or exit
    if [ $? -ne 0 ]; then
        printf "\n${RED}Something went wrong while stopping existing processes.\n";
        printf "Exiting $RESET\n";
        exit;
    fi
  fi
  printf "\nRemoving stopped processes";
  # Remove all processes (if running now stopped)
  docker rm $(docker ps -a -q --filter name=codewind)
  # Check remove command ran properly or exit
  if [ $? -ne 0 ]; then
      printf "\n${RED}Something went wrong while removing existing processes.\n";
      printf "Exiting $RESET\n";
      exit;
  else
    printf "\n${GREEN}Existing processes stopped and removed $RESET\n";
  fi
else
  printf "\n${GREEN}No existing processes found $RESET\n";
fi

printf "\n${GREEN}Downloading cwctl to start Codewind containers $RESET\n";
printf "${YELLOW}Set CW_CLI_BRANCH={branch} to override the branch used to pull cwctl $RESET\n";
curl -o ./script/cli-pull.sh -sS https://raw.githubusercontent.com/eclipse/codewind-vscode/master/dev/bin/cli-pull.sh
chmod +x ./script/cli-pull.sh

cd script
./cli-pull.sh
cd - 

OS=$(uname -a | awk '{print $1;}')
CWCTL=./script/linux/cwctl
if [ $OS == "Darwin" ]; then
  CWCTL=./script/darwin/cwctl
fi

# REMOVE PREVIOUS DOCKER PROCESSES FOR CODEWIND
printf "\n\n${BLUE}CHECKING FOR EXISTING CODEWIND APPS $RESET\n";
# Check for existing processes (stopped or running)
$CWCTL stop-all

$CWCTL start --debug

if [ $? -eq 0 ]; then
    printf "\n\n${GREEN}SUCCESSFULLY STARTED CONTAINERS $RESET\n";
    printf "\nCurrent running codewind containers\n";
    docker ps --filter name=codewind
else
    printf "\n\n${RED}FAILED TO START CONTAINERS $RESET\n";
    exit;
fi

printf "\n\n${BLUE}PAUSING TO ALLOW CONTAINERS TIME TO START $RESET\n";
sleep 20;

# Check to see if any containers exited straight away
printf "\n\n${BLUE}CHECKING FOR codewind CONTAINERS THAT EXITED STRAIGHT AFTER BEING RUN $RESET\n";
EXITED_PROCESSES=$(docker ps -q --filter "name=codewind" --filter "status=exited"  | wc -l)
if [ $EXITED_PROCESSES -gt 0 ]; then
  printf "\n${RED}Exited containers found $RESET\n";
  # docker ps --filter "name=codewind" --filter "status=exited";
  NUM_CODE_ZERO=$(docker ps -q --filter "name=codewind" --filter "status=exited" --filter "exited=0" | wc -l);
  NUM_CODE_ONE=$(docker ps -q --filter "name=codewind" --filter "status=exited" --filter "exited=1" | wc -l);
  if [ $NUM_CODE_ZERO -gt 0 ]; then
    printf "\n${RED}$NUM_CODE_ZERO found with an exit code '0' $RESET\n";
    docker ps --filter "name=codewind" --filter "status=exited" --filter "exited=0";
    printf "\nUse 'docker logs [container name]' to find why the exit happened";
  fi
  if [ $NUM_CODE_ONE -gt 0 ]; then
    printf "\n${RED}$NUM_CODE_ONE found with an exit code '1' $RESET\n";
    docker ps --filter "name=codewind" --filter "status=exited" --filter "exited=1";
    printf "\nUse 'docker logs [container name]' to debug exit";
  fi
else
  printf "\n${GREEN}No containers exited $RESET\n";
fi

printf "\n\n${BLUE}CODEWIND CONTAINERS NOW AVAILABLE. PORTAL API ACCESSIBLE AT localhost:10000, PERFORMANCE UI at localhost:9095 $RESET\n";

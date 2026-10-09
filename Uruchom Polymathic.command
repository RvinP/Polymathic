#!/bin/zsh -l
# Start from Finder with the user's normal login environment.
cd -- "${0:A:h}" || exit 1

# Finder nie wczytuje ~/.zshrc, a to tam zwykle jest nvm (Node/npm) i ~/.local/bin (claude).
# Dokładamy je sami, żeby skrót działał tak samo jak polecenie wpisane w Terminalu.
path=("$HOME/.local/bin" /opt/homebrew/bin /usr/local/bin $path)
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if ! command -v npm >/dev/null 2>&1 && [[ -s "$NVM_DIR/nvm.sh" ]]; then
  source "$NVM_DIR/nvm.sh" >/dev/null 2>&1
  nvm use --silent default >/dev/null 2>&1
fi
if ! command -v npm >/dev/null 2>&1; then
  # Brak aliasu „default” w nvm — bierzemy najnowszą zainstalowaną wersję Node.
  najnowszy=("$NVM_DIR"/versions/node/*/bin(N/nOn[1]))
  [[ -n "$najnowszy" ]] && path=("$najnowszy" $path)
fi

if ! command -v npm >/dev/null 2>&1; then
  print 'Nie znaleziono npm. Uruchom ten projekt w Terminalu z dostępnym Node.js.'
  read -r '?Naciśnij Enter, aby zamknąć… '
  exit 1
fi

if [[ ! -d node_modules ]]; then
  print 'Brakuje zależności. W katalogu projektu wykonaj npm install, a potem uruchom ten plik ponownie.'
  read -r '?Naciśnij Enter, aby zamknąć… '
  exit 1
fi

print 'Uruchamiam Polymathic. Pozostaw to okno otwarte podczas korzystania z aplikacji.'
npm start
polymathic_exit=$?
if (( polymathic_exit != 0 && polymathic_exit != 130 )); then
  print '\nNie udało się uruchomić aplikacji. Komunikat błędu znajduje się powyżej.'
  read -r '?Naciśnij Enter, aby zamknąć… '
fi
exit "$polymathic_exit"

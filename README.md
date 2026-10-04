# Mesh Chat – czat Bluetooth mesh bez internetu (Android)

Zdecentralizowany czat peer-to-peer. Każdy telefon jest węzłem sieci **Bluetooth Low Energy mesh**:
jednocześnie **Central** (skanuje i łączy się) i **Peripheral** (rozgłasza się i przyjmuje połączenia).
Wiadomości są przekazywane przez pośrednie telefony (multi-hop), więc docierają też do osób poza
bezpośrednim zasięgiem Bluetooth.

- React Native 0.86 + Expo SDK 57 (CNG / prebuild, własny moduł natywny w Kotlinie), TypeScript
- `react-native-ble-plx`: rola Central
- `modules/mesh-peripheral`: lokalny moduł Expo (Kotlin), rola Peripheral (GATT server + advertising) i foreground service
- Zustand (stan), expo-sqlite z SQLCipher (zaszyfrowana historia), expo-secure-store (klucze), React Native Paper (UI, Material 3), Expo Router
- `tweetnacl`: podpisy Ed25519 każdego pakietu i szyfrowanie end-to-end (X25519 + XSalsa20-Poly1305)

Aplikacja ma dwa rodzaje ruchu: **rozmowy 1:1 szyfrowane end-to-end** oraz **alerty kont urzędowych** –
publiczne, podpisane komunikaty, które może nadać tylko urządzenie z certyfikatem. Grup nie ma: zwykły
użytkownik nie może rozgłaszać treści do całej sieci. Model bezpieczeństwa opisuje sekcja
[Bezpieczeństwo](#bezpieczeństwo).

Osobno działa **Kurier** (zakładka Informacje): odpowiada na pytania o sytuacje kryzysowe wyłącznie na
podstawie oficjalnych źródeł dołączonych do aplikacji i pokazuje, skąd pochodzi każda informacja. To jedyna
część aplikacji, która korzysta z internetu – patrz [Kurier](#kurier--pytania-do-oficjalnych-źródeł).

---

## Budowanie

Wymagania: Node 20+, JDK 17+, Android SDK (API 36) i **fizyczne urządzenia** z Androidem 8.0+ (API 26).
Emulator nie ma Bluetooth, a do testu meshu potrzebne są co najmniej 2–3 telefony.

```bash
npm install --legacy-peer-deps      # react-dom jest opcjonalnym peerem expo; flaga omija konflikt npm
npx expo prebuild --platform android --clean
npx expo run:android                # debug build + instalacja na podłączonym urządzeniu
npm start                           # dev server (dev client) przy kolejnych uruchomieniach
```

Release APK: `npx expo run:android --variant release` albo EAS: `npx eas-cli@latest build -p android`.

> Katalog `android/` jest generowany (Continuous Native Generation). Nie edytuj go ręcznie:
> konfiguracja jest w `app.json`, a kod natywny w `modules/mesh-peripheral`.
> Aplikacja **nie działa w Expo Go**, bo zawiera własny kod natywny.

Kontrola jakości: `npm run typecheck`, `npm run lint`, `npm test`, `npx expo-doctor`.

`npm test` (Jest) sprawdza warstwę protokołu bez telefonu: podpisy pakietów, szyfrowanie, certyfikaty,
handshake, reguły alertów, router na symulowanych łączach (fałszerstwa, powtórzenia, rozchodzenie
alertów) oraz kilka kompletnych węzłów naraz (wiadomość przez przekaźnik, wzajemna weryfikacja jednym
skanem i próby jej nadużycia, alert i wiadomość konta urzędowego). Radia BLE, magazynu kluczy i szyfrowania bazy nie da się sprawdzić inaczej niż na urządzeniach.

> Po zmianie wtyczek w `app.json` (SQLCipher, aparat, SecureStore) potrzebny jest nowy `prebuild`
> i nowy build – sam dev server nie wystarczy.

---

## Uprawnienia

Przy pierwszym uruchomieniu aplikacja od razu pokazuje **systemowe dialogi Androida**. Nie da się
przejść dalej, dopóki wymagane uprawnienia nie zostaną nadane (guardy w `src/app/_layout.tsx`).
Po nadaniu pojawia się toast z potwierdzeniem. Jeśli użytkownik wybierze „Nie pytaj ponownie”,
ekran wyjaśnia sytuację i otwiera ustawienia systemowe aplikacji. Po powrocie uprawnienia są
sprawdzane ponownie automatycznie.

| Uprawnienie | Typ | Android | Po co |
|---|---|---|---|
| `BLUETOOTH_SCAN` | runtime | 12+ | wyszukiwanie węzłów |
| `BLUETOOTH_CONNECT` | runtime | 12+ | połączenia GATT (obie role) |
| `BLUETOOTH_ADVERTISE` | runtime | 12+ | rozgłaszanie własnego węzła |
| `ACCESS_FINE_LOCATION` / `ACCESS_COARSE_LOCATION` | runtime | wszystkie | wyniki skanu BLE (wymóg systemu, GPS nie jest używany) |
| `POST_NOTIFICATIONS` | runtime | 13+ | powiadomienie usługi działającej w tle |
| `BLUETOOTH`, `BLUETOOTH_ADMIN` | przy instalacji | ≤ 11 | Bluetooth na starszych systemach (`maxSdkVersion=30`) |
| `FOREGROUND_SERVICE` | przy instalacji | wszystkie | usługa w tle |
| `FOREGROUND_SERVICE_CONNECTED_DEVICE` | przy instalacji | 14+ | typ usługi `connectedDevice` |
| `INTERNET` | przy instalacji | wszystkie | wyłącznie pytania do Kuriera (dodaje je szablon Expo) |

Uprawnienia „przy instalacji” to *normal permissions*. System nadaje je automatycznie
i nie ma dla nich dialogu, więc ekran uprawnień pokazuje je tylko informacyjnie. Deklaracje są
w `modules/mesh-peripheral/android/src/main/AndroidManifest.xml` i w `app.json`.

---

## Architektura

```
src/
  app/                    Expo Router: trasy i guardy (cienkie pliki re-eksportujące ekrany)
  screens/                Permissions, Onboarding, Conversations, Network, Chat, Settings,
                          Alerts, ComposeAlert, Security, MyKey, VerifyContact, InstallCert, Recovery,
                          RAG (zakładka Informacje), Kurier, Sources, Source
  components/             AlertBanner, TrustBadge, QrScanner, NetworkStatusBar, MessageBubble…
  hooks/                  useMeshLifecycle, useNetworkStatus
  store/                  Zustand: identity, contacts, alerts, permissions, mesh, chat, rag (+ typy domenowe)
  services/
    ble/                  LinkManager (fizyczne łącza), PeripheralRole, fragmenter, stałe
    crypto/               keys + identity (klucze urządzenia), box + e2e (szyfrowanie 1:1),
                          cert + authorities + trustAnchors (certyfikaty kont urzędowych)
    mesh/                 packet (format i podpis), handshake (HELLO), MeshRouter (routing),
                          alertPolicy (reguły alertów), SeenCache, MeshService (czat i alerty)
    permissions/          dialogi systemowe, „nie pytaj ponownie”, ustawienia
    rag/                  Kurier: kb (baza źródeł), search (wyszukiwanie na telefonie), llm (proxy modelu),
                          kurier (plan → wyszukiwanie → odpowiedź z cytatami)
    security/             blokada ekranu i potwierdzenie biometrią
    storage/              SQLCipher (migracje, repozytoria czatu, kontaktów, alertów), kv-store (flagi)
  utils/                  base64/UTF-8/UUID, losowość, nicki, token bucket, emitter, logger
modules/mesh-peripheral/  Kotlin: MeshGattServer, MeshForegroundService, MeshPeripheralModule
scripts/authority-ca.js   offline'owe narzędzie wydające certyfikaty kont urzędowych
scripts/kb-build.js       pobiera oficjalne źródła i buduje z nich bazę wiedzy Kuriera
kb/sources.json           manifest źródeł bazy wiedzy (adres, wydawca, licencja, data i suma kontrolna)
__tests__/                testy protokołu (Jest)
```

Warstwy (od dołu):

```
┌──────────────────────────────────────────────────────────────┐
│ UI (Paper)  ←→  Zustand stores                               │
├──────────────────────────────────────────────────────────────┤
│ MeshService   czat 1:1 (E2E, ACK, retry), alerty, SQLCipher  │
├──────────────────────────────────────────────────────────────┤
│ MeshRouter    podpisy + flooding + dedup + TTL + trasy       │
├──────────────────────────────────────────────────────────────┤
│ LinkManager   linki BLE, fragmentacja, duty-cycle, reconnect │
├───────────────────────────────┬──────────────────────────────┤
│ ble-plx (Central)             │ MeshPeripheral (Kotlin)      │
│ skan, connect, write, notify↓ │ GATT server, adv, FGS        │
└───────────────────────────────┴──────────────────────────────┘
```

### Dlaczego własny moduł natywny?

`react-native-ble-plx` obsługuje tylko rolę **Central**. Prawdziwy mesh wymaga, żeby każdy telefon
dał się też znaleźć i do niego podłączyć (**Peripheral**). Dostępne biblioteki peripheral dla RN są
porzucone albo nie obsługują GATT servera z notyfikacjami, dlatego `modules/mesh-peripheral`
implementuje:

- **GATT service** `7a3f0001-…` z dwiema charakterystykami:
  - `RX` (write): centrale zapisują do nas ramki,
  - `TX` (notify): wysyłamy ramki do subskrybujących central (kolejka per urządzenie, bo Android
    pozwala na jedną notyfikację naraz; czeka na `onNotificationSent` albo timeout),
- **advertising**: UUID usługi + manufacturer data `0xFFFF` z 4-bajtowym skrótem ID węzła (31 B limit),
- **foreground service** typu `connectedDevice`, który trzyma proces (JS + BLE) przy życiu w tle,
- prośbę o włączenie Bluetooth (systemowy dialog).

---

## Jak działa mesh

### 1. Łącza (LinkManager)

- Każdy węzeł **rozgłasza się i skanuje** jednocześnie (dual role).
- **Tie-break**: z pary A–B łączy się tylko węzeł o mniejszym skrócie ID, więc powstaje jedno
  łącze zamiast dwóch. Jeśli drugi węzeł nie połączy się w ciągu 20 s (np. nie umie być Peripheral),
  łączymy się sami. Ewentualne duplikaty są usuwane po handshake'u HELLO według tej samej
  deterministycznej reguły po obu stronach.
- **Handshake z wyzwaniem**: po zestawieniu łącza obie strony wymieniają podpisane `HELLO` z losowym
  wyzwaniem; łącze zostaje przypisane do węzła dopiero, gdy ten odeśle `HELLO` z echem naszego wyzwania,
  zaadresowane do nas. Nagranego `HELLO` nie da się więc odtworzyć na innym łączu. Do tego momentu
  łączem płynie wyłącznie `HELLO`; brak odpowiedzi w 15 s zamyka łącze. Rozgłoszenie BLE niesie numer
  wersji protokołu – węzły w innej wersji są ignorowane.
- Limit: 4 łącza wychodzące i 7 łącznie (limit stosu BLE Androida). W tłumie powstaje więc
  częściowa siatka, a zasięg zapewnia relaying.
- **Fragmentacja**: pakiet dzielony jest na ramki `[streamId][index][count][dane]` dopasowane do MTU
  (wynegocjowane 517 B, domyślnie 23 B) i składany po drugiej stronie. Ramka ma najwyżej 512 B
  niezależnie od MTU – tyle wynosi limit wartości atrybutu GATT, a Android 13+ odrzuca dłuższe.
- **Reconnect**: po rozłączeniu węzeł wraca do kandydatów, a kolejne próby mają wykładniczy
  backoff (2 s → 60 s).

### 2. Routing (MeshRouter): *controlled flooding + reverse-path routes*

Format pakietu v2 (nagłówek 59 B, big-endian, na końcu klucz i podpis autora):

```
version | type | ttl | hops | flags | packetId(8) | origin(16) | destination(16) | seq(4) | timestamp(8) | len(2) | payload(JSON) | signPk(32) | sig(64)
```

`origin` to skrót klucza `signPk`, a `sig` to podpis Ed25519 nad nagłówkiem (bez `ttl`/`hops` – tylko
te dwa bajty wolno zmienić przekaźnikowi) i payloadem. Każdy węzeł może więc sam sprawdzić każdy pakiet.

Relay przetwarza pakiet tak:

1. **Rate limit per łącze** (token bucket 60/25 s⁻¹), sprawdzany przed parsowaniem.
2. **Deduplikacja** po `origin + packetId` (LRU 16 384 wpisy, 25 min). Każdy węzeł przekazuje dany pakiet
   najwyżej raz, więc pętle są niemożliwe nawet przy cyklach w topologii.
3. **Tanie testy przed kryptografią**: łącze uwierzytelnione, `ttl + hops` w granicach typu, dozwolony
   adresat (rozgłaszać wolno tylko `ANNOUNCE` i `ALERT`), czas pakietu w oknie ±10 min, `ANNOUNCE` nie
   starszy niż ostatnio widziany, alert nowszy niż zapisany.
4. **Podpis**: klucz musi dawać `origin`, a podpis musi się zgadzać. Dopiero wtedy pakiet trafia do
   pamięci widzianych. Sfałszowany pakiet może pochodzić tylko od sąsiada, który go przysłał (uczciwy
   przekaźnik by go nie przepuścił), więc po 3 takich łącze jest zamykane na minutę.
5. **Rate limit per nadawca** (czat/ACK 15 szt. + 1/s, ANNOUNCE 2 szt. + 0,2/s, alerty osobno). Nadmiar
   nie jest ani doręczany, ani przekazywany dalej. Limit liczony jest po uwierzytelnionym nadawcy.
6. **Uczenie tras**: pakiet od X przyszedł łączem L po `hops` skokach, więc zapisujemy trasę
   „X przez L, koszt hops+1”, jeśli jest lepsza, świeższa albo stara wygasła.
7. Doręczenie lokalne, jeśli `destination` to my.
8. **Relay**, jeśli `ttl > 1`: TTL maleje, `hops` rośnie.
   - `ANNOUNCE` idzie do wszystkich łączy poza źródłowym, z losowym opóźnieniem 15–90 ms
     przeciw kolizjom (broadcast storm),
   - pakiet kierowany idzie do sąsiada docelowego, jeśli jest bezpośrednio połączony; w przeciwnym
     razie do next-hop z tablicy tras, a bez znanej trasy albo z flagą `ForceFlood` floodem
     (ponowienie zalewa także wtedy, gdy adresat wygląda na sąsiada).

Typy pakietów:

| Typ | TTL | Opis |
|---|---|---|
| `HELLO` | 1 | handshake z wyzwaniem na nowym łączu, nigdy nie jest przekazywany |
| `ANNOUNCE` | 5 | co 30 s (w tle co 60 s) i po każdym nowym łączu; buduje tablicę tras i listę węzłów; konto urzędowe dołącza certyfikat po nowym łączu i do co czwartego |
| `CHAT` | 7 | wiadomość 1:1, kierowana, szyfrowana end-to-end |
| `ACK` | 7 | potwierdzenie doręczenia, kierowane do autora, szyfrowane |
| `ALERT` | 1 | komunikat konta urzędowego; rozchodzi się „od magazynu do magazynu” (patrz niżej) |

### 3. Czat (MeshService)

- Wiadomość ma **UUID** (klucz idempotencji), **ID nadawcy** i **timestamp**. `INSERT OR IGNORE`
  w SQLite eliminuje duplikaty, nawet gdy ta sama wiadomość przyjdzie kilkoma ścieżkami.
- Statusy: `sending` (wysyłanie), **wysłana** (przekazana ≥1 sąsiadowi), **czeka** (na zasięg odbiorcy),
  **dostarczona** (przyszedł ACK), **nieudana**.
  Bez ACK następują ponowienia po 4, 10 i 20 s z `ForceFlood` (trasa mogła się zdezaktualizować).
  Potem wiadomość **czeka na telefonie nadawcy do 24 h** – także po restarcie aplikacji – i wychodzi sama,
  gdy odbiorca pojawi się na liście węzłów (oraz co 60 s, dopóki na niej jest); spóźniony ACK nadal się
  liczy. Wysłana z opóźnieniem niesie w szyfrogramie czas napisania. Po 24 h status „nieudana”; dotknięcie
  takiego dymka ponawia wysyłkę.
- Odbiorca **zawsze** odsyła ACK, także na duplikat (poprzedni ACK mógł zaginąć). ACK jest szyfrowany
  tak jak wiadomość i liczy się tylko wtedy, gdy przyszedł od rozmówcy.
- **Każda rozmowa jest szyfrowana end-to-end** (NaCl box: X25519 + XSalsa20-Poly1305,
  `services/crypto/box.ts`). Węzły pośrednie widzą tylko nagłówek pakietu (nadawca, odbiorca, czas),
  bez treści i nicku. Jawny tekst zawiera pola `from` i `to`, sprawdzane z podpisanym nagłówkiem –
  bez tego przekaźnik mógłby przypisać sobie cudzy szyfrogram.
- **Anty-spam po stronie nadawcy**: 5 wiadomości od razu, potem 1/s. Treść ma max 500 znaków,
  a nick max 24 znaki (oczyszczany ze znaków sterujących, niewidocznych i zmieniających kierunek tekstu).

### 4. Alerty kont urzędowych

- Alert to publiczny, podpisany komunikat (nagłówek, treść, termin ważności do 72 h) z dołączonym
  certyfikatem nadawcy. Aplikacja pokazuje aktywne alerty na **przypiętym pasku u góry każdego ekranu**;
  paska nie da się zamknąć, tylko zwinąć do jednej linii.
- **Rozchodzenie**: alert zawsze leci tylko do sąsiada. Węzeł zapisuje go i podaje dalej wyłącznie wtedy,
  gdy był dla niego nowością. To obsługuje pierwszy zalew sieci, **spóźnionych** (przy zestawieniu łącza
  węzły porównują skróty swoich zbiorów alertów i dosyłają różnicę) oraz łączenie się rozdzielonych wysp.
- Jeden rekord na `(nadawca, id)`: wygrywa nowszy podpisany czas, przy remisie odwołanie. Odwołanie
  zostaje w pamięci do terminu ważności alertu, więc stary pakiet nie „wskrzesi” odwołanego komunikatu.
- Najwyżej 5 alertów na urząd (zawsze najnowsze); jeden urząd nie może wypchnąć alertów innego.
- Przekaźnik nie odrzuca alertu z powodu własnego zegara (chyba że wygasł ponad dobę temu) – o tym,
  czy alert jest wyświetlany, decyduje ścisła reguła po stronie odbiorcy.
- Wiadomości 1:1 od konta urzędowego są oznaczane „PILNE · nazwa urzędu”, a rozmowa z urzędem jest
  przypięta na górze listy.

### 5. Bateria i praca w tle

| Profil | Skan | Pauza | Tryb skanu | Advertising |
|---|---|---|---|---|
| brak łączy (szukanie) | 8 s | 2 s | LowLatency | Balanced |
| połączony, na ekranie | 6 s | 4 s | Balanced | Balanced |
| w tle | 5 s | 40 s | LowPower | LowPower |

- Skanowanie tylko z filtrem UUID usługi (działa też przy wyłączonym ekranie).
- Android ogranicza start skanu do 5 razy na 30 s; cykle są dłuższe, więc limit nie jest przekraczany.
- Foreground service (stałe powiadomienie „Połączenia: X · węzły w sieci: Y”) utrzymuje połączenia
  po zminimalizowaniu aplikacji.

---

## Kurier – pytania do oficjalnych źródeł

Zakładka **Informacje** odpowiada na pytania o przygotowanie do sytuacji kryzysowych i zachowanie w ich
trakcie. Odpowiedź powstaje wyłącznie z bazy oficjalnych źródeł dołączonej do aplikacji (Poradnik
bezpieczeństwa, RCB, MSWiA, PSP, GIS, PAA, CERT Polska i inne: 252 dokumenty, ok. 4300 fragmentów), a każde
zdanie ma odnośnik do fragmentu, z którego pochodzi. Odnośnik otwiera czytnik na cytowanym fragmencie, więc
da się przeczytać także tekst wokół. Źródła można też przeglądać samodzielnie – to działa bez internetu.

**Kurier jest jedyną częścią aplikacji, która używa internetu.** Pytanie i znalezione fragmenty źródeł
przechodzą przez nasze proxy do zewnętrznego modelu językowego; rozmowy w czacie tym kanałem nie płyną.

### Jak powstaje odpowiedź

1. **Plan** – model dostaje pytanie i spis dokumentów; zwraca frazy do wyszukania i numery dokumentów,
   w których spodziewa się odpowiedzi. Na pytanie nie odpowiada. Pytanie spoza tematu kończy się tutaj.
2. **Wyszukiwanie** – na telefonie (`search.ts`): BM25 po fragmentach, słowa sprowadzone do uproszczonych
   rdzeni bez polskich znaków, tytuł i nagłówek liczone podwójnie. Dokumenty wskazane w planie dają swój
   najlepszy fragment, resztę uzupełnia ranking; nowsze i ważniejsze źródła mają pierwszeństwo.
3. **Odpowiedź** – model pisze z ośmiu fragmentów i każde zdanie oznacza `[n]`. Może raz poprosić
   o wyszukanie innych fraz albo odpowiedzieć, że źródła nie zawierają odpowiedzi.
4. **Kontrola** – aplikacja usuwa odnośniki do fragmentów, których nie podała, i nie pokazuje odpowiedzi,
   która nie wskazuje żadnego. Wtedy wyświetla „Nie znalazłem odpowiedzi w źródłach” i najbliższe fragmenty.

Jedno pytanie to dwa zapytania do proxy (trzy, gdy model poprosi o ponowne wyszukanie), zwykle 2–4 s.
Proxy przyjmuje `POST { key, query }` i zwraca `{ response }`; ma własne limity (na adres IP i dobowy).

### Baza źródeł

- `kb/sources.json` – ręcznie edytowany manifest: adres, wydawca, grupa, licencja, priorytet. `"include": false`
  wyłącza źródło, a `"excluded"` mówi dlaczego (duplikat, wersja obcojęzyczna, PDF bez tekstu, treść nieaktualna).
- `node scripts/kb-build.js fetch` – pobiera oryginały do `kb/raw/` (poza gitem, ok. 360 MB) i zapisuje
  w manifeście datę, rozmiar i sumę SHA-256.
- `node scripts/kb-build.js build` – wyciąga tekst (HTML: `node-html-parser`; PDF: `pdftotext` z pakietu
  poppler-utils), tnie go na fragmenty i zapisuje `src/services/rag/kb/kb.json` (ok. 3 MB, w repozytorium).
  Źródła, które nie przechodzą kontroli tekstu (za mało treści, zgubione polskie znaki), są wypisywane i pomijane.

Fragmenty jednego dokumentu nie nachodzą na siebie – czytnik składa z nich cały tekst. Z PDF-ów zostaje numer
strony, ze stron internetowych nagłówek sekcji; opisy alternatywne infografik Poradnika bezpieczeństwa
są włączone jako tekst.

**Licencje.** Teksty z gov.pl są na licencji CC BY-SA 4.0 (grafiki, nagrania i filmy na CC BY-NC-ND 4.0 –
dlatego baza zawiera wyłącznie tekst), akty prawne nie podlegają ochronie. Część źródeł nie deklaruje
licencji albo zastrzega prawa (m.in. ABW, PSE, IMGW-PIB, NASK, pacjent.gov.pl); włączono je ze względu na
wagę treści i trzeba to rozstrzygnąć przed publicznym wydaniem. Licencja każdego dokumentu jest w manifeście
i w czytniku. Baza (`kb.json`) jako opracowanie tekstów CC BY-SA 4.0 jest udostępniana na tej samej licencji;
zmiany wobec oryginałów to wyłącznie wyodrębnienie tekstu i podział na fragmenty.

### Konfiguracja i sprawdzanie

`.env.local` (poza gitem) w katalogu głównym:

```
EXPO_PUBLIC_KURIER_API_URL=https://…/chat
EXPO_PUBLIC_KURIER_API_KEY=…
```

Zmienne `EXPO_PUBLIC_*` są wkompilowane w paczkę aplikacji, więc klucz proxy da się z niej odczytać –
chronią go limity po stronie proxy, a klucz dostawcy modelu zostaje na serwerze.

`npm test` sprawdza bez sieci: ekstrakcję i podział tekstu, wyszukiwanie (także na dołączonej bazie),
odczyt planu i odnośników oraz całą pętlę z podstawionym modelem. Próba na prawdziwym proxy (zużywa jego limit):

```bash
KURIER_LIVE=1 node --env-file=.env.local node_modules/jest/bin/jest.js __tests__/kurierLive-test.ts
```

---

## Bezpieczeństwo

Aplikacja pokazuje użytkownikowi ten sam obraz, co poniżej: Ustawienia → Bezpieczeństwo wylicza stan
zabezpieczeń **z faktycznego stanu urządzenia** (czy baza jest zaszyfrowana, czy jest blokada ekranu,
czy zegar zgadza się z sąsiadami, ile kontaktów zweryfikowano) i listę tego, czego aplikacja nie chroni.

### Przed kim chronimy

| Przeciwnik | Co potrafi |
|---|---|
| Podsłuchujący w eterze | odbiera ruch BLE, nic nie wysyła |
| Złośliwy węzeł / przekaźnik | zmodyfikowana aplikacja w sieci: fałszuje, powtarza, gubi, zalewa |
| Podszywający się pod urząd | chce wyświetlić ludziom fałszywy „pilny komunikat” |
| Znalazca / złodziej telefonu | ma urządzenie w ręku |

Poza modelem: zagłuszanie radiowe, przejęty system Android (root, malware), przymus wobec użytkownika.

### Zagrożenia i zabezpieczenia

| Zagrożenie | Zabezpieczenie |
|---|---|
| Odczyt treści rozmowy przez przekaźnik lub podsłuch | NaCl box; przekaźnik widzi tylko nagłówek |
| Podszycie pod innego użytkownika | ID węzła = skrót klucza podpisującego; każdy pakiet podpisany Ed25519 i sprawdzany na każdym skoku |
| Podmiana klucza szyfrującego ofiary | klucz szyfrujący przyjmowany tylko z pakietu podpisanego przez tę tożsamość |
| Przypisanie sobie cudzego szyfrogramu | pola `from`/`to` wewnątrz szyfrogramu, porównywane z podpisanym nagłówkiem |
| Zmiana nagłówka (czas, adresat) w drodze | podpis obejmuje cały nagłówek poza `ttl`/`hops` |
| Powtórzenie nagranego pakietu | podpisany `packetId`, pamięć widzianych, okno czasu ±10 min, trwała deduplikacja po ID wiadomości |
| Przejęcie łącza powtórzonym `HELLO` | handshake z wyzwaniem; odpowiedź adresowana do pytającego |
| Fałszywe potwierdzenia doręczenia | ACK podpisany, szyfrowany, przyjmowany tylko od rozmówcy |
| Zalew sieci treścią | rozgłaszać mogą tylko konta z certyfikatem; limity po uwierzytelnionym nadawcy; łącze zamykane po 3 fałszerstwach |
| Fałszywy „urząd” | status urzędowy wyłącznie z certyfikatu podpisanego kluczem głównym; nazwa urzędu z certyfikatu, nigdy z nicku |
| Mylące nicki | trzy różne oznaczenia (konto urzędowe / klucz zweryfikowany / niezweryfikowany), ostrzeżenie przy nazwie zbieżnej ze zweryfikowanym kontaktem |
| Podstawiony rozmówca przy pierwszym kontakcie | weryfikacja klucza kodem QR lub porównaniem odcisku na głos |
| Podglądacz przy weryfikacji (zdjęcie kodu z ekranu) | jednorazowy kod przypisany do jednej rozmowy; ten sam kod z drugiego urządzenia = ostrzeżenie i cofnięcie |
| Odczyt danych z przejętego telefonu | ziarno kluczy i klucz bazy w SecureStore (szyfrowane kluczem z Android Keystore), baza SQLCipher, backup Androida wyłączony |
| Nadanie alertu z cudzego, odblokowanego telefonu | biometria lub kod blokady przed każdym alertem; certyfikat instaluje się tylko na telefonie z blokadą ekranu |

### Tożsamość i weryfikacja kluczy

- Urządzenie ma jedno 32-bajtowe ziarno. Z niego powstaje para Ed25519 (podpisy) i para X25519
  (szyfrowanie). ID węzła to pierwsze 16 bajtów SHA-512 klucza podpisującego.
- **Odcisk klucza** to pełne 128 bitów ID w 8 grupach po 4 znaki (Ustawienia → Mój klucz, razem z kodem QR).
- W czacie ikona tarczy otwiera weryfikację. **Wystarczy jeden skan, żeby zweryfikowali się oboje:**
  jedna osoba wybiera „Pokaż mój kod”, druga skanuje.
  - Skanujący ufa pokazującemu, bo zeskanowany klucz daje ID tej rozmowy.
  - Pokazujący ufa skanującemu, bo kod zawiera jednorazowy token, a telefon skanującego odsyła go
    zaszyfrowany. Token jest **przypisany do rozmowy, z której otwarto kod** – przyjmowany jest tylko
    od tego jednego węzła, żyje 2 minuty, tylko w pamięci, i znika po wyjściu z aplikacji.
  - Ten sam token od innego urządzenia oznacza, że ktoś podejrzał ekran albo rozmowa nie jest z osobą,
    która stoi obok. Wtedy **ten kod nie weryfikuje nikogo na telefonie pokazującego**: to, co nadał
    w ostatniej minucie, jest cofane (wcześniejsza, własna weryfikacja kontaktu zostaje), a na ekranie
    weryfikacji tej rozmowy pojawia się ostrzeżenie z odciskiem obcego urządzenia. Skanujący zachowuje
    to, co sam sprawdził aparatem.
  - Żeby osoba stojąca obok zawsze zdążyła wywołać to ostrzeżenie, kod zostaje na ekranie jeszcze
    przez chwilę po przyjęciu, a telefon skanujący wysyła dowód także wtedy, gdy klucz **nie** pasuje
    do jego rozmowy (czyli gdy ktoś siedzi pośrodku). Wyścig z podglądaczem kończy się więc
    ostrzeżeniem i powtórką, a nie fałszywą plakietką. Ceną jest to, że podglądacz może w ciągu minuty
    unieważnić cudzą weryfikację tym kodem – wtedy obie osoby skanują ponownie.
  - Kod z ekranu Ustawienia → Mój klucz to sam klucz publiczny (bez tokenu): jego skan weryfikuje
    tylko jedną stronę. Tak samo porównanie odcisków na głos.
  - Weryfikację można cofnąć na ekranie weryfikacji; cofnięcie jest ostateczne (spóźniony dowód ani
    spóźniony konflikt już niczego nie zmienią).
- Utrata kluczy (np. przeniesienie aplikacji na inny telefon) nigdy nie kończy się cichym
  wygenerowaniem nowej tożsamości – aplikacja pokazuje ekran odzyskiwania i czeka na decyzję użytkownika.
  To samo dotyczy klucza bazy danych.

### Konta urzędowe – jak powstają i dlaczego nie da się pod nie podszyć

1. **Klucz główny (root)** powstaje raz, na komputerze bez sieci: `node scripts/authority-ca.js init`.
   Sekret jest szyfrowany hasłem (scrypt + secretbox) i zapisywany w `ca/root.key` (ignorowany przez git).
   Do aplikacji trafia tylko klucz publiczny (`src/services/crypto/authority-roots.json`) – po `init`
   trzeba zbudować aplikację ponownie.
2. **Urzędnik** instaluje zwykłą aplikację. Jego klucz powstaje na jego telefonie i go nie opuszcza.
3. **Wydanie certyfikatu, osobiście.** Operator sprawdza tożsamość i upoważnienie, po czym uruchamia:
   ```bash
   node scripts/authority-ca.js issue --key "<klucz z ekranu Mój klucz>" --name "Urząd Miasta – WZK" --days 30
   ```
   Narzędzie pokazuje odcisk klucza – operator porównuje **wszystkie grupy** z ekranem telefonu.
4. Narzędzie drukuje certyfikat jako tekst i kod QR. Urzędnik skanuje go w Ustawienia → Konto urzędowe.
   Telefon przyjmie certyfikat tylko wtedy, gdy podpisał go klucz główny i gdy dotyczy on klucza tego
   właśnie telefonu.
5. Każdy alert i każda wiadomość urzędnika niesie certyfikat, więc odbiorca sprawdza wszystko
   z jednego pakietu, bez internetu. Do `ANNOUNCE` urzędnik dołącza certyfikat tylko po zestawieniu
   łącza i co czwarty raz (z certyfikatem pakiet nie mieści się w jednej ramce BLE), a do `HELLO` wcale –
   odbiorca zapamiętuje certyfikat raz zobaczony.

Podrobienie konta urzędowego wymagałoby klucza głównego (offline, pod hasłem) albo telefonu urzędnika
razem z jego odciskiem palca lub kodem blokady. Sam certyfikat jest publiczny – skopiowany z eteru nic
nie daje, bo bez klucza prywatnego nie da się podpisać pakietu.

Urząd **nie ma** wglądu w prywatne rozmowy: nie istnieje depozyt kluczy ani uprawnienia moderacyjne.

> W PoC klucz główny to klucz deweloperski. We wdrożeniu produkcyjnym potrzebna jest procedura
> organizacyjna: kto go przechowuje, sprzętowy moduł kluczy lub podział klucza, rotacja. Repozytorium
> zawiera pustą listę kluczy głównych – dopóki nie wykonasz `init`, żadne konto urzędowe nie jest uznawane.

## Ograniczenia i dalszy rozwój

- **Metadane są jawne**: przekaźniki widzą, kto do kogo pisze, kiedy i jak długą wiadomość.
- **Brak forward secrecy**: klucze są długoterminowe (bez ratchetu jak w Noise/Signal). Kto nagra
  szyfrogramy, a później zdobędzie klucz z telefonu, odczyta dawne rozmowy.
- **Unieważnienie certyfikatu = jego wygaśnięcie.** Lista zablokowanych numerów i kluczy jest wszyta
  w aplikację (`authority-roots.json`), więc dociera tylko z aktualizacją. Dlatego certyfikaty są
  krótkie (domyślnie 30 dni, najwyżej 90).
- **Alerty są publiczne**: podpisane, ale nieszyfrowane.
- **Kurier wymaga internetu i zaufania do zewnętrznego dostawcy.** Pytanie i fragmenty źródeł trafiają przez
  proxy do zewnętrznego modelu językowego i nie są szyfrowane end-to-end. Klucz proxy jest w paczce aplikacji.
- **Odpowiedź Kuriera to automatyczne streszczenie.** Aplikacja pilnuje, żeby każda odpowiedź wskazywała
  fragmenty źródeł, ale nie sprawdza, czy zdanie wiernie oddaje fragment – po to odnośnik otwiera źródło.
  Wyszukiwanie jest pełnotekstowe (bez embeddingów), a o doborze fraz decyduje model.
- **Baza źródeł to migawka** z dnia pobrania; aktualizacja wymaga ponownego `fetch`, `build` i nowego wydania.
  56 stron z obszaru zdrowia i skażeń dodano bez przeglądu treści (pole `note` w manifeście).
- **Złośliwy przekaźnik może gubić i opóźniać pakiety** oraz zaniżać ich zasięg (obniżając `ttl`); nie
  może ich czytać, zmieniać ani podrabiać. Handshake nie wyklucza węzła, który przezroczyście przekazuje
  ruch między dwoma telefonami – „bezpośredni sąsiad” to wskazówka dla routingu, nie dowód.
- Węzeł, który dołączył do sieci przez przekaźnik, może do 2 min (do 4 min, gdy aplikacja urzędu działa
  w tle) widzieć konto urzędowe jako zwykły węzeł – do najbliższego `ANNOUNCE` z certyfikatem. Alerty
  i wiadomości urzędu niosą certyfikat zawsze.
- **Zegar**: pakiety z czasem różniącym się o ponad 10 minut są odrzucane. Aplikacja porównuje zegar
  z sąsiadami i ostrzega, ale nie potrafi go poprawić.
- Klucze w trakcie pracy są w pamięci aplikacji; SecureStore i SQLCipher chronią dane w spoczynku.
  Potwierdzenie biometrią przed alertem to bramka w interfejsie, nie zabezpieczenie kryptograficzne.
- Koszt weryfikacji podpisów w czystym JavaScripcie nie został zmierzony na telefonie. Ustawienia →
  Sieć (diagnostyka) pokazują średni czas weryfikacji – jeśli przekracza ok. 10 ms, trzeba dodać budżet
  weryfikacji na łącze albo natywną implementację Ed25519.
- Brak powiadomień systemowych o alertach, gdy aplikacja jest w tle.
- Brak store-and-forward dla wiadomości 1:1: niedostarczona wiadomość czeka tylko na telefonie nadawcy
  (do 24 h), inne telefony jej nie przechowują – dotrze, gdy nadawca i odbiorca znajdą się w jednej sieci.
- Protokół v2 nie jest zgodny z v1: po aktualizacji urządzenie dostaje nowe ID, a stara,
  niezaszyfrowana baza jest usuwana.
- Po ubiciu procesu przez system (np. agresywne oszczędzanie baterii producenta) mesh się zatrzymuje.
  Warto wyłączyć optymalizację baterii dla aplikacji.
- iOS nie jest wspierany (projekt Android-only; moduł natywny ma tylko implementację Kotlin).

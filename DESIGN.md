---
version: alpha
name: Mesh Chat
description: >
  Komunikator mesh (BLE) działający bez infrastruktury, w języku wizualnym
  inspirowanym aplikacją mObywatel: urzędowy błękit, chłodne jasne tło,
  białe karty, pastylkowe akcenty.
colors:
  # Marka
  primary: "#0052A5"
  on-primary: "#FFFFFF"
  primary-container: "#D6E6F8"
  on-primary-container: "#0A2A52"
  secondary: "#D4213D"
  on-secondary: "#FFFFFF"
  # Powierzchnie (jasny)
  background: "#F2F5FA"
  on-background: "#1A2233"
  surface: "#FFFFFF"
  on-surface: "#1A2233"
  surface-variant: "#E8EEF6"
  on-surface-variant: "#5B6577"
  outline: "#8A94A6"
  outline-variant: "#DDE3EC"
  # Powierzchnie (ciemny)
  primary-dark: "#4A9EF0"
  on-primary-dark: "#06213F"
  primary-container-dark: "#17406E"
  on-primary-container-dark: "#D6E6F8"
  background-dark: "#15171B"
  on-background-dark: "#F1F3F6"
  surface-dark: "#23262B"
  on-surface-dark: "#F1F3F6"
  surface-variant-dark: "#2D3137"
  on-surface-variant-dark: "#A4ACB9"
  outline-dark: "#6B7482"
  outline-variant-dark: "#343941"
  # Statusy
  connected: "#22A06B"
  searching: "#E2A400"
  offline: "#8A8F8E"
  error: "#D32F2F"
  error-container: "#FAE6E6"
  error-container-dark: "#4D282C"
  error-text-dark: "#E29193"
typography:
  display:
    fontFamily: System
    fontSize: 32px
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: -0.01em
  title-lg:
    fontFamily: System
    fontSize: 20px
    fontWeight: 600
    lineHeight: 1.3
  title-md:
    fontFamily: System
    fontSize: 17px
    fontWeight: 600
    lineHeight: 1.35
  body-lg:
    fontFamily: System
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.45
  body-md:
    fontFamily: System
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.45
  label-md:
    fontFamily: System
    fontSize: 13px
    fontWeight: 500
    lineHeight: 1.3
  label-sm:
    fontFamily: System
    fontSize: 11px
    fontWeight: 500
    lineHeight: 1.3
rounded:
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  full: 9999px
spacing:
  base: 8px
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 24px
  gutter: 16px
components:
  app-bar:
    backgroundColor: "{colors.background}"
    textColor: "{colors.on-surface}"
    typography: "{typography.title-lg}"
    height: 56px
  tab-bar:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface-variant}"
    typography: "{typography.label-md}"
    height: 64px
  tab-bar-item-active:
    backgroundColor: "{colors.primary-container}"
    textColor: "{colors.primary}"
    rounded: "{rounded.full}"
  list-row:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    typography: "{typography.title-md}"
    rounded: "{rounded.md}"
    padding: 16px
    height: 64px
  icon-tile:
    backgroundColor: "{colors.primary-container}"
    textColor: "{colors.primary}"
    rounded: "{rounded.sm}"
    size: 40px
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    rounded: "{rounded.lg}"
    padding: 16px
  chip:
    backgroundColor: "{colors.primary-container}"
    textColor: "{colors.primary}"
    typography: "{typography.label-md}"
    rounded: "{rounded.full}"
    padding: 8px
    height: 32px
  status-tag:
    backgroundColor: "{colors.surface-variant}"
    textColor: "{colors.on-surface}"
    typography: "{typography.label-md}"
    rounded: "{rounded.full}"
    height: 28px
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.title-md}"
    rounded: "{rounded.full}"
    padding: 16px
    height: 48px
  button-primary-disabled:
    backgroundColor: "{colors.surface-variant}"
    textColor: "{colors.outline}"
  button-tonal:
    backgroundColor: "{colors.primary-container}"
    textColor: "{colors.primary}"
    typography: "{typography.title-md}"
    rounded: "{rounded.full}"
    height: 48px
  button-destructive:
    backgroundColor: "{colors.error}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.full}"
    height: 48px
  text-field:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    typography: "{typography.body-lg}"
    rounded: "{rounded.md}"
    padding: 16px
    height: 48px
  segmented-control:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface-variant}"
    typography: "{typography.label-md}"
    rounded: "{rounded.full}"
    height: 48px
  segmented-control-selected:
    backgroundColor: "{colors.primary-container}"
    textColor: "{colors.primary}"
    rounded: "{rounded.full}"
  bottom-sheet:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    rounded: "{rounded.lg}"
    padding: 16px
  message-bubble-out:
    backgroundColor: "{colors.primary-container}"
    textColor: "{colors.on-primary-container}"
    typography: "{typography.body-lg}"
    rounded: "{rounded.lg}"
    padding: 12px
  message-bubble-in:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    typography: "{typography.body-lg}"
    rounded: "{rounded.lg}"
    padding: 12px
  message-meta:
    textColor: "{colors.on-surface-variant}"
    typography: "{typography.label-sm}"
  message-input:
    backgroundColor: "{colors.surface-variant}"
    textColor: "{colors.on-surface}"
    typography: "{typography.body-lg}"
    rounded: "{rounded.full}"
    padding: 12px
    height: 48px
  send-button:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.full}"
    size: 48px
  avatar:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.title-md}"
    rounded: "{rounded.full}"
    size: 48px
  unread-badge:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.label-sm}"
    rounded: "{rounded.full}"
    height: 20px
  network-status-bar:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    typography: "{typography.title-md}"
    rounded: "{rounded.lg}"
    padding: 12px
    height: 56px
  alert-banner:
    backgroundColor: "{colors.error}"
    textColor: "{colors.on-primary}"
    typography: "{typography.title-md}"
    padding: 12px
  message-bubble-official:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    typography: "{typography.body-lg}"
    rounded: "{rounded.lg}"
    padding: 12px
  trust-badge-official:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.label-md}"
    rounded: "{rounded.full}"
    height: 24px
  trust-badge-verified:
    backgroundColor: "{colors.primary-container}"
    textColor: "{colors.on-primary-container}"
    typography: "{typography.label-md}"
    rounded: "{rounded.full}"
    height: 24px
  trust-badge-unverified:
    backgroundColor: "{colors.surface-variant}"
    textColor: "{colors.on-surface-variant}"
    typography: "{typography.label-md}"
    rounded: "{rounded.full}"
    height: 24px
---

## Overview

Mesh Chat to komunikator awaryjny: wiadomości skaczą między telefonami po
Bluetooth, gdy nie ma sieci komórkowej ani internetu. Interfejs ma budzić to
samo zaufanie co aplikacja państwowa — spokojny, czytelny, przewidywalny —
dlatego czerpie z języka wizualnego mObywatela: jeden urzędowy błękit, chłodne
bardzo jasne tło, białe karty z miękkim cieniem i pastylkowe elementy akcji.

Charakter: **rzeczowy, opanowany, obywatelski.** Żadnych ozdobników ani
gradientów w tle. Użytkownik może być w stresie, na zewnątrz, z jedną wolną
ręką — liczy się kontrast, duże cele dotykowe i stan sieci widoczny na pierwszy
rzut oka.

To jest stylistyka _inspirowana_ mObywatelem, nie jego kopia: nie używamy godła,
nazwy ani logotypów mObywatela i nie sugerujemy, że to aplikacja rządowa.

## Colors

Paleta jest niemal monochromatyczna: błękit + chłodne szarości. Kolor poza
błękitem zawsze coś znaczy (status, błąd).

- **Primary (#0052A5):** urzędowy błękit. Oznacza „to da się dotknąć":
  przyciski główne, aktywna zakładka, linki, kafelki ikon; także awatary,
  licznik nieprzeczytanych i ikona „dostarczono". Tytuły ekranów są w kolorze
  tekstu (on-surface), nie w primary.
- **Primary container (#D6E6F8):** bladoniebieskie pastylki — chipy
  („Wszystkie"), podświetlenie aktywnej zakładki, **dymek wysłanej wiadomości**.
  Tekst na nim: on-primary-container (#0A2A52).
- **Secondary (#D4213D):** karmazyn z flagi. Wyłącznie drobny akcent tożsamości
  (np. znak aplikacji w onboardingu). Nigdy jako kolor akcji — żeby nie mylił
  się z błędem.
- **Background (#F2F5FA):** chłodne, lekko niebieskawe tło ekranów. To ono
  sprawia, że białe karty i dymki „odklejają się" bez obramowań.
- **Surface (#FFFFFF):** karty, wiersze list, dymki odebrane, pole wpisywania,
  dolny pasek zakładek.
- **Surface variant (#E8EEF6):** tła drugiego planu — pole wpisywania
  wiadomości, neutralne etykiety stanu, wyłączone przyciski, stan naciśnięcia
  wiersza, placeholdery.
- **On-surface (#1A2233) / on-surface-variant (#5B6577):** granatowo-grafitowy
  tekst główny i szary tekst pomocniczy (godzina, „3 skoki", podtytuły).
- **Outline variant (#DDE3EC):** jedyny dopuszczalny separator; cienka linia
  1px, używana oszczędnie.

Statusy sieci mesh (zawsze z ikoną lub etykietą, nigdy samym kolorem):

- **Connected (#22A06B):** są sąsiedzi, wiadomości idą.
- **Searching (#E2A400):** skanowanie, brak węzłów.
- **Offline (#8A8F8E):** Bluetooth wyłączony / mesh zatrzymany.
- **Error (#D32F2F):** niedostarczona wiadomość, akcje usuwające, **pilny
  komunikat konta urzędowego**. W tej ostatniej roli zawsze z ikoną
  ośmiokąta i słowem „PILNE" — sam kolor nie wystarcza. Jako wypełnienie
  (baner alertu, przycisk usuwający, krążek błędu) to zawsze #D32F2F z białym
  tekstem, w obu trybach. Jako tekst, ikona lub obramowanie 1px: #D32F2F w
  trybie jasnym, error-text-dark (#E29193) w ciemnym. Tło ostrzeżeń to
  error-container (#FAE6E6 / #4D282C) z tekstem w kolorze on-surface; czerwień
  niesie tam tylko ikona. Na dymku wysłanym (primary-container) tekst
  ostrzeżenia jest w on-primary-container, a czerwień niosą ikona i
  obramowanie.

Kolory connected, searching i offline nigdy nie są kolorem tekstu (za mały
kontrast). Występują jako krążek z ciemną ikoną (#1A2233; na krążku błędu
biała) albo kropka, zawsze obok słowa w kolorze on-surface.

**Tryb ciemny** używa tokenów z sufiksem `-dark`: grafitowe tło (#15171B),
jaśniejsze karty (#23262B) i rozjaśniony błękit (#4A9EF0) jako primary. Dymek
wysłany to primary-container-dark (#17406E) z jasnym tekstem. Kolory statusów
pozostają bez zmian; wyjątkiem jest tekst błędu, rozjaśniony do error-text-dark
(#E29193).

## Typography

Krój systemowy (San Francisco na iOS, Roboto na Androidzie) — bez ładowania
fontów, bo aplikacja ma działać offline i startować natychmiast. Hierarchię
buduje waga i rozmiar, nie kolor.

- **display (32/700):** duży tytuł ekranu głównego („Mesh Chat", „Sieć mesh",
  „Ustawienia"), wyrównany do lewej, w kolorze on-surface; także ekrany
  powitalne i liczby statystyk sieci.
- **title-lg (20/600):** tytuł ekranu podrzędnego obok przycisku „Wróć",
  nagłówki sekcji, tytuł arkusza dolnego.
- **title-md (17/600):** tytuł wiersza listy, nazwa rozmowy, etykieta
  przycisku, **stan sieci**, nagłówek alertu.
- **body-lg (16/400):** treść wiadomości, treść arkusza, pola formularzy. Nie
  schodzić poniżej 16px dla treści czatu.
- **body-md (14/400):** podgląd ostatniej wiadomości, opisy ustawień, teksty
  pomocnicze.
- **label-md (13/500):** plakietka zaufania, „PILNE · urząd", etykiety stanu,
  szczegóły stanu sieci, etykiety zakładek i pól. To najmniejszy rozmiar
  tekstu, który mówi o stanie sieci, zaufania lub dostarczenia.
- **label-sm (11/500):** wyłącznie godzina i liczba skoków w dymku, licznik
  nieprzeczytanych, wartość dBm.

Wagi 500 i 600 renderują się na Androidzie tylko wtedy, gdy styl nie podaje
nazwy rodziny kroju. Style tekstu pochodzą wyłącznie z mapy `type` w
`src/theme.ts`; jedyna rodzina ustawiana ręcznie to `monospace` dla kluczy. Nie
ma wag poza tymi siedmioma stylami. Jedyny wyjątek: nazwa urzędu w zdaniu
„Nadajesz jako …” na ekranie nowego alertu (body-md, waga 600). Liczby w
licznikach i tabelach: cyfry tabelaryczne.

Tytuły pisane zwykłą kapitalizacją zdania, bez wersalików. Teksty UI po polsku.

## Layout

Jedna kolumna, mobile-first. Siatka 8px (4px dla drobnych odstępów wewnątrz
komponentów).

- Margines boczny ekranu: **16px** (`gutter`).
- Odstęp między kartami/wierszami listy: **8px**; między sekcjami: **24px**.
- Nagłówek sekcji po lewej, pastylkowa akcja (chip) po prawej w tej samej
  linii — wzorzec „Dokumenty · Wszystkie".
- Wiersze rozmów i węzłów to osobne białe karty z odstępem 8px, nie ciągła
  lista z separatorami. Wiersze ustawień i uprawnień jednej sekcji leżą we
  wspólnej karcie (16px) i są rozdzielone linią outline-variant 1px
  zaczynającą się na krawędzi tekstu.
- Minimalny cel dotykowy: **44×44px**; przyciski, segmenty i przyciski ikon
  mają **48px** rzeczywistej wysokości (nie przez powiększony obszar dotyku).
- Główna akcja ekranu leży na dole, w zasięgu kciuka: w dolnym pasie akcji nad
  safe area (16px po bokach) albo jako pływająca pastylka nad paskiem zakładek
  (Czaty).
- Tytuł ekranu głównego jest przypięty pod paskiem systemowym (56px; 48px i
  title-lg na ekranach niższych niż 700px) i nie przewija się.
- Czat: dymki max **82%** szerokości, wysłane do prawej, odebrane do lewej,
  2px odstępu w ramach jednego nadawcy, 12px margines boczny. Pole wpisywania
  przyklejone do dołu nad klawiaturą, z poszanowaniem safe area.
- Dolny pasek: 4 zakładki (Czaty, Sieć, Informacje, Ustawienia), ikona + podpis.

## Elevation & Depth

Głębia jest płytka i wynika głównie z kontrastu biała karta / chłodne tło.

- **Poziom 0:** tło ekranu, pasek nawigacji (zlewa się z tłem, bez cienia).
- **Poziom 1:** karty, wiersze list, karta stanu sieci, pola formularzy — jeden
  rozproszony cień bez twardej krawędzi (y 2px, blur 8px, on-surface 8%). Nie
  używamy androidowego `elevation` ani neutralnych obramowań. Dymki wiadomości
  są płaskie, bez cienia.
- **Poziom 2:** dolny pasek zakładek i pasek pola wpisywania — cienka linia
  outline-variant od góry zamiast cienia. Pływająca pastylka akcji: cień
  y 4px, blur 12px, 16%.
- **Poziom 3:** arkusze dolne — cień y −8px, blur 24px, 16% + przyciemnienie
  tła. Nie używamy wyśrodkowanych dialogów.

W trybie ciemnym cienie znikają; poziomy odróżnia jaśniejsza powierzchnia.
Arkusz dolny ma w trybie ciemnym powierzchnię surface-variant-dark.

## Shapes

Kształty są miękkie, ale nie zabawkowe.

- **md (12px):** wiersze list, pola formularzy.
- **lg (16px):** karty, dymki wiadomości. Dymek ma „ogonek": róg przy nadawcy
  (prawy dolny dla wysłanych, lewy dolny dla odebranych) zmniejszony do
  **xs (4px)**.
- **full:** wszystko, co jest akcją lub znacznikiem — przyciski, chipy, pole
  wpisywania, awatary, liczniki, podświetlenie aktywnej zakładki.
- **sm (8px):** kafelki ikon 40px w wierszach list (tło primary-container,
  ikona primary; dla akcji usuwających error-container i ikona w kolorze
  błędu). Kafelek 64px na ekranach startowych ma promień lg.

Ikony: konturowe, kreska ~2px (MaterialCommunityIcons w wariantach `-outline`),
w kolorze primary lub on-surface-variant.

## Motion

Ruch jest krótki i bez sprężynowania. Naciśnięcie: przyciemnienie + skala 0.98
(80 ms / 140 ms); wiersze we wspólnej karcie tylko przyciemnienie. Bez efektu
ripple. Przejście między ekranami: wsunięcie z prawej. Arkusz dolny: 220 ms.
Wskaźnik segmentu: 160 ms. Animujemy tylko przesunięcie, skalę i
przezroczystość; przy włączonym ograniczeniu ruchu zostaje samo przyciemnienie.
Baner alertu zwija się bez animacji.

## Components

- **App bar:** tło równe tłu ekranu, bez cienia. Zakładki główne nie mają
  paska — ekran zaczyna się dużym tytułem display, do lewej, w kolorze
  on-surface; po prawej opcjonalnie jedna akcja tonalna. Ekrany podrzędne mają
  pasek 56px: okrągły przycisk „Wróć" 48px i tytuł title-lg obok niego, do
  lewej. W czacie pasek ma 64px: awatar 40px, nazwa rozmowy (title-md), pod
  spodem kropka stanu i opis zasięgu (label-md, do 2 linii), po prawej ikona
  tarczy.
- **Tab bar:** biały, z linią outline-variant u góry, 64px. Aktywna zakładka:
  wypełniona ikona 24px i podpis label-md w primary, pod ikoną pastylka
  primary-container 64×32. Nieaktywne: ikona konturowa i podpis w
  on-surface-variant.
- **List row (rozmowa, węzeł, ustawienie):** min. 64px; awatar 48px albo
  kafelek ikony 40px po lewej, tytuł title-md + opis body-md, po prawej godzina
  label-sm i licznik albo szewron 24px (nawigacja), ołówek (edycja), strzałka
  „na zewnątrz" (ustawienia systemu) lub nic (akcja z potwierdzeniem). Elementy
  boczne zawsze wyśrodkowane w pionie.
- **Chip:** bladoniebieska pastylka z tekstem primary — akcja drugorzędna.
  Bierna etykieta stanu (**status tag**) to pastylka surface-variant 28px ze
  słowem w on-surface; nie jest przyciskiem i nie stoi obok plakietki zaufania.
- **Button primary:** pełna pastylka 48px w primary, biały tekst title-md, na
  całą szerokość w dolnym pasie akcji. Jeden na ekran. Długa etykieta łamie się
  do dwóch linii, nie jest ucinana.
- **Button tonal / text:** akcje drugorzędne — pastylka 48px w
  primary-container z tekstem primary albo sam tekst primary (48px). „Anuluj" w
  arkuszu to przycisk tonalny.
- **Button destructive:** jak primary, w kolorze error; tylko dla akcji
  nieodwracalnych, w arkuszu potwierdzenia. Akcja, która dopiero otwiera
  potwierdzenie, jest przyciskiem tekstowym w kolorze błędu. Wyjątek: ekran
  odzyskiwania, gdzie akcja usuwająca jest jedyną akcją ekranu – tam pastylka
  error stoi w dolnym pasie akcji i otwiera arkusz potwierdzenia.
- **Message bubble (out):** primary-container, tekst on-primary-container.
  W stopce godzina + ikona statusu: zegar (wysyłanie), ptaszek (wysłana),
  klepsydra (czeka na zasięg odbiorcy), podwójny ptaszek w primary
  (dostarczona). Dymki są płaskie. W serii
  wiadomości jednego nadawcy odstęp wynosi 2px, a ogonek ma tylko ostatni
  dymek; między seriami 8px.
- **Message bubble (in):** biały. W stopce „N skoki · godzina", gdy wiadomość
  przeszła więcej niż jeden skok.
- **Message bubble (official):** wiadomość od konta urzędowego. Obramowanie 1px
  w kolorze błędu, nad treścią ikona ośmiokąta + „PILNE · nazwa urzędu"
  (label-md). Nazwa pochodzi z certyfikatu, nigdy z nicku.
- **Message bubble (waiting):** własna wiadomość, która czeka u nadawcy na
  zasięg odbiorcy (do 24 h) i wyjdzie sama. Ikona klepsydry i podpis „Czeka na
  zasięg odbiorcy" (label-md) w on-surface-variant. To nie błąd: bez
  obramowania i bez akcji po dotknięciu.
- **Message bubble (failed):** obramowanie 1px i ikona alertu w kolorze błędu,
  podpis „Nie dostarczono · dotknij, aby ponowić" (label-md,
  on-primary-container).
- **Message input:** pastylka surface-variant 48px bez obramowania na białym
  pasku z linią outline-variant u góry; obok okrągły przycisk wysyłania 48px w
  primary z ikoną konturową; nieaktywny, gdy pole puste.
- **Avatar:** koło 48px na listach, 40px w nagłówku czatu, tło primary, białe
  inicjały — jak „AA"/„JK" w mObywatelu. Dla rozróżnienia rozmówców
  dopuszczalne stonowane odcienie z tej samej rodziny chłodnych barw.
- **Network status bar:** biała karta (lg, min. 56px) pod tytułem ekranu,
  zawsze widoczna, nieprzewijana: krążek 36px w kolorze statusu z ikoną, obok
  stan sieci w title-md i szczegóły w label-md („3 bezpośr. · 12 w sieci");
  tekst nigdy nie jest ucinany. Szewron, gdy karta prowadzi do zakładki „Sieć".
  Stan czyta się z koloru, ikony i słów jednocześnie.
- **Signal bars:** 4 słupki; aktywne w kolorze connected, nieaktywne w
  outline-variant.
- **Alert banner:** pasek w kolorze error na całą szerokość, pierwszy element
  każdego głównego ekranu — nad tytułem i kartą stanu sieci. #D32F2F i biały
  tekst w obu trybach, bez przezroczystości; najmniejszy tekst to label-md.
  Ikona ośmiokąta 24px, „PILNE · nazwa urzędu", nagłówek (title-md), do 3 linii
  treści. Nie da się go zamknąć, dopóki alert jest aktywny — tylko zwinąć do
  jednej linii strzałką; nowszy alert rozwija go ponownie. Dotknięcie otwiera
  listę komunikatów. Tego wyglądu nie używa nic innego.
- **Trust badge:** pastylka 24px z ikoną tarczy 16px i tekstem label-md, trzy
  wyraźnie różne stany: „Konto urzędowe" (pełny primary, biały tekst — tylko z
  certyfikatu), „Klucz zweryfikowany" (primary-container), „Niezweryfikowany"
  (surface-variant). Konto urzędowe ma też awatar z ikoną budynku zamiast
  inicjałów.
- **Security notice:** biały blok (surface, lg) z kłódką na początku rozmowy
  („Rozmowa szyfrowana end-to-end…"). Gdy nazwa rozmówcy pokrywa się ze
  zweryfikowanym kontaktem innego urządzenia: blok error-container z pełnym
  krążkiem błędu i białą ikoną, pierwsze zdanie w title-md.
- **Text field:** etykieta label-md nad polem; pole 48px, promień md,
  wypełnione (surface na tle ekranu, background wewnątrz arkusza), bez
  obramowania w spoczynku, 2px primary po zaznaczeniu, 2px w kolorze błędu przy
  błędzie. Pod polem komunikat z ikoną (body-md) i licznik znaków (label-md).
- **Segmented control:** biały tor 48px (full) z przesuwanym wskaźnikiem
  primary-container; wybrana opcja ma etykietę i ikonę w primary (opcja bez
  własnej ikony — ptaszek). Bez obramowań i linii.
- **Bottom sheet:** potwierdzenia i krótkie formularze. Przyklejony do dołu,
  górne rogi lg, tytuł title-lg, treść body-lg, przyciski 48px na całą
  szerokość: akcja u góry (error dla nieodwracalnych), „Anuluj" (tonal) na
  samym dole. Zamyka go dotknięcie tła i przycisk wstecz; nie ma uchwytu do
  przeciągania.
- **Floating action:** pastylka primary 48px z ikoną i podpisem „Nowa rozmowa"
  w prawym dolnym rogu listy rozmów. Konto urzędowe ma akcję „Nowy alert" jako
  przycisk tonalny w wierszu tytułu. Nie używamy FAB-ów ani speed dial.
- **Status disc:** krążek 28–36px w kolorze statusu z ciemną ikoną (białą na
  czerwonym), zawsze obok słowa.
- **Notice:** blok lg z ikoną 24px i tekstem body-md: neutralny (surface),
  potwierdzenie (primary-container), błąd (error-container, tekst on-surface,
  ikona w kolorze błędu).
- **Empty state:** wyśrodkowane koło 64px (primary-container albo
  surface-variant) z ikoną konturową i zdanie body-lg w on-surface-variant.
  Ikona w kole to nie ilustracja.
- **Key grid:** odcisk klucza w siatce 4×2 grup krojem monospace 16px tam,
  gdzie porównuje się go na głos (Mój klucz, Weryfikacja klucza); 14px w
  miejscach informacyjnych (powitanie, wiersz ustawień, ostrzeżenie) i dla
  klucza publicznego w siatce 4×4. Siatka jest identyczna na obu telefonach.

## Do's and Don'ts

**Do**

- Używaj błękitu primary dla jednej, najważniejszej akcji na ekranie.
- Układaj treść w białych kartach na tle background; oddzielaj odstępem.
- Pokazuj stan sieci mesh zawsze i wszędzie tam, gdzie wpływa na wysyłkę.
- Łącz kolor statusu z ikoną lub tekstem (dostępność, daltonizm).
- Trzymaj kontrast tekstu min. 4.5:1 i cele dotykowe min. 44px.
- Sprawdzaj każdy ekran w trybie jasnym i ciemnym.
- Tytuł ekranu zawsze do lewej, w kolorze tekstu.

**Don't**

- Nie używaj czerwieni (secondary) do przycisków ani linków — czerwień w akcji
  znaczy błąd lub usunięcie.
- Nie dodawaj gradientów, ilustracji w tle ani dodatkowych kolorów akcentu.
- Nie rysuj separatorów między wierszami, które są już osobnymi kartami.
- Nie używaj godła, nazwy ani logotypów mObywatela; nie podszywaj się pod
  aplikację rządową. Oznaczenie „Konto urzędowe" i styl „PILNE" przysługują
  wyłącznie nadawcom z ważnym certyfikatem — nigdy na podstawie nicku, i bez
  godła ani barw państwowych.
- Nie pokazuj stanu zabezpieczeń „na sztywno": ekran Bezpieczeństwo ma
  odzwierciedlać faktyczny stan urządzenia, razem z tym, czego aplikacja nie
  chroni.
- Nie polegaj na fontach ani zasobach pobieranych z sieci — aplikacja działa
  offline.
- Nie zmniejszaj treści wiadomości poniżej 16px.
- Nie pisz tekstu kolorem statusu (zielony, żółty, szary) ani kolorem błędu na
  tle primary-container lub error-container.
- Nie dodawaj neutralnych obramowań 1px do kart i dymków — obramowanie 1px w
  kolorze błędu jest zarezerwowane dla wiadomości urzędowych, nieudanych i
  aktywnych alertów.
- Nie używaj cienia `elevation`, efektu ripple ani gotowych widżetów Material
  (FAB, wyśrodkowany dialog, pole z obrysem i pływającą etykietą, obrysowane
  przyciski segmentowe).
- Nie używaj ikony ośmiokąta na zwykłych akcjach.

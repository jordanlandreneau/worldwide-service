// Content 3.0 only loads when a section is opened, so the page copies didn't include it.
const RAW: Record<string, string> = {
  A: "Aceite|Oil;Aceite de motor|Motor oil;Aceite multigrado|Multigrade oil;Acelerador|Accelerator;Agua|Water;Aire acondicionado|Air conditioning;Alternador|Alternator;Amortiguador|Shock absorber;Antena|Aerial (GB), Antenna (US);Arranque|Ignition;Asiento del acompañante|Passenger seat;Asiento delantero|Front seat;Asiento para niños|Child seat;Asiento trasero|Back seat;Automático|Automatic",
  B: "Baca del coche|Roof rack;Barra de remolque|Tow bar;Barra de tracción|Drawbar;Batería|Battery;Bocina|Horn;Bomba de aceite|Oil pump;Bomba de agua|Water pump;Bomba de aire|Air pump;Bujía|Spark plug;Bujía de encendido|Ignition spark plug;Bujías|Spark plugs",
  C: "Cable del acelerador|Throttle cable;Caja de cambios|Gear box;Caja de fusibles|Fuse box;Calefacción|Heater;Capó|Bonnet (GB), Hood (US);Capota|Bonnet;Carburador|Carburetor;Carrocería|Bodywork;Cerradura|Lock;Cerradura del maletero|Trunk lock;Cerradura eléctrica|Electric door lock;Cierre centralizado|Central locking;Cinturón de seguridad|Seatbelt;Contador de kilómetros|Odometer (US);Correa|Belt;Cubierta del motor|Engine cover",
  D: "Depósito de refrigerante|Coolant tank;Disco de embrague|Clutch disc;Disco de freno|Brake disc",
  E: "Embrague|Clutch;Encendedor|Cigarette lighter;Escape|Exhaust;Espejo retrovisor|Rear-view mirror;Espejo retrovisor lateral|Side mirror (US);Exterior de la carrocería|Body exterior",
  F: "Faro delantero|Headlight;Faro trasero|Rear light;Faros|Headlamps;Faros|Headlights;Filtro de aceite|Oil filter;Filtro de aire|Air filter;Freno de mano|Handbrake;Frenos|Brakes;Fusible|Fuse",
  G: "Guantera|Glove compartment;Guardabarros|Mudflap (GB), Splash guard (US)",
  I: "Indicador de gasolina|Fuel gauge;Indicador de nivel de combustible|Petrol gauge;Indicador de temperatura|Temperature gauge;Interior del coche|Car interior;Intermitente|Indicator;Interruptor de luces de faros|Headlight switch;Interruptor de luz|Light switch;Inyección|Injection;Inyección electrónica|Electronic fuel injection;Inyector diesel|Diesel fuel injector;Inyector gasolina|Fuel injector, gasoline",
  L: "Lateral|Lateral;Limpiaparabrisas|Windscreen wiper (US), Windscreen wiper (GB);Lubricante|Lubricant, lube;Luces de emergencia|Hazard lights;Luces de estacionamiento|Parking lights;Luces de posición|Sidelights;Luz avisadora de fallo|Fault light;Luz de emergencia|Warning light;Luz trasera|Rear light",
  M: "Maletero|Boot;Manual|Manual;Matricula|Plate;Matricular|Tax disc;Motor de arranque|Starter;Motor diesel|Diesel engine;Motor en V|V engine",
  N: "Navegación por satélite|Sat nav (abreviación desatellite navigation);Neumático|Tire (US), Tyre (GB);Número de matrícula|Number plate",
  P: "Palanca de cambios|Gear stick;Palanca de cambios|Gear lever (GB), Gear shift (US);Panel del radiador|Radiator core;Parabrisas|Windscreen (GB), Windshield (US);Parachoques|Bumper;Pedal de embrague|Clutch pedal;Pedal de freno|Brake pedal;Polea|Pulley;Puerta trasera|Hatch, tailgate",
  R: "Radiador|Radiator;Relé|Relay;Retrovisor|Rear view mirror;Retrovisor lateral|Wing mirror;Rueda|Wheel;Rueda de recambio|Spare wheel;Rueda delantera|Front wheel;Rueda motora|Drive wheel;Rueda trasera|Rear wheel",
  S: "Salida de aire caliente|Hot-air outlet;Salpicadero|Dashboard;Seguro de la puerta|Door lock;Sensor|Sensor;Sistema de admisión|Intake system;Sistema de alarma|Alarm system;Sistema de arranque|Starter system;Sistema de calefacción|Heating system;Sistema de combustible|Fuel intake system;Sistema de dirección|Steering system;Sistema de embrague|Clutch system;Sistema de encendido|Ignition system;Sistema de enfriamiento|Cooling system;Sistema de escape|Exhaust system;Sistema de frenos|Brake system;Sistema de iluminación|Lighting system;Sistema de inyección de comb.|Fuel injection system;Sistema de lubricación|Lubrication system;Sistema de seguridad|Security system;Sistema de suspensión|Suspension system;Sistema electrónico|Electronic system",
  T: "Tablero|Dashboard;Tanque de combustible|Fuel tank;Tanque de gasolina|Petrol tank;Tapa de combustible|Fuel cap;Techo|Roof;Temperatura|Temperature;Toma de corriente|Socket;Tracción delantera|Front-wheel drive;Transmisión|Transmission;Transmisión automática|Automatic transmission – A/T;Tubo de escape|Exhaust pipe",
  V: "Válvula|Valve;Varilla|Push rod;Velocímetro|Speedometer;Ventana|Window;Ventanilla|Door window;Ventilación|Air vent;Ventilador|Fan;Volante|Steering wheel",
  Z: "Zapatas de freno|Brake shoes",
};
const video = (name: string, token: string) => `https://firebasestorage.googleapis.com/v0/b/bdctool-e9dc3.appspot.com/o/videos%2F${name}.m4v?alt=media&token=${token}`;
const VIDEOS: Record<string, [string, string][]> = {
  "Elder Ford": [["MY KARMA - ELDER FORD", video("karma", "ef224792-e6e3-4d24-8478-ddc7ca43ab60")]],
  "Largo Honda": [["Using the system and selecting a service advisor", video("largo1", "613102d2-0384-40c4-ae7f-106aa55b5aad")], ["The reason why we always must select a service advisor", video("largo2", "f61d77b0-ef3b-49c5-b215-740cebf50a4b")]],
  "Jim Cogdill": [["How to use the tool and made an appointment", video("cogdill1", "ca69907e-ad49-4c15-9d88-fb66003d4cf9")], ["How to communicate with service advisors and other departments", video("cogdill2", "62896a96-57ed-4aab-9ec4-7f3eb6dc0665")]],
  "Kia of Frisco": [["How to use the tool", video("frisco1", "33a6f548-dce8-45a0-99e2-aa0b02d6b70d")], ["How to modify any appointment", video("frisco2", "830cd0c3-ac21-4b09-b739-05d52968df76")]],
  "Grossman Stores": [["GROSSMAN STORES - Videos", video("grossman", "7f2a4001-164a-4495-a2ab-0ba8add18ddc")]],
  "Betten Baker": [["BETTEN BAKER STORES", video("betten", "dfb0f338-99d7-4de4-a3cc-3a968a04a939")]],
};

const terms = (letter: string) => RAW[letter].split(";").map((t) => t.split("|")).map(([es, en]) => `<article class="x-term" data-term><strong>${es}</strong><span>${en}</span></article>`).join("");
const videos = (list: [string, string][]) => list.map(([title, src]) => `<article class="x-video"><h4>${title}</h4><video controls preload="none" src="${src.replace(/&/g, "&amp;")}"></video></article>`).join("");

// Adds the missing content, closed, right after each section's button.
export function withExtras(html: string) {
  let out = html.replace(/(<div id="dictionary-letter-(.)"[^>]*>[\s\S]*?<\/button>)/g, (m, head, letter) => (RAW[letter] ? `${head}<div class="x-term-grid" data-panel hidden>${terms(letter)}</div>` : m));
  for (const [label, list] of Object.entries(VIDEOS)) {
    const button = new RegExp(`<button(?:(?!<button)[^>])*aria-expanded="false"[^>]*>(?:(?!</button>)[\\s\\S])*?>${label}<(?:(?!</button>)[\\s\\S])*?</button>`);
    out = out.replace(button, (m) => `${m}<div class="x-video-list" data-panel hidden>${videos(list)}</div>`);
  }
  return out;
}

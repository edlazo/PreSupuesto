import Link from "next/link";

/** One entry of the in-page index. */
interface Section {
  id: string;
  title: string;
  summary: string;
}

const SECTIONS: Section[] = [
  {
    id: "materiales",
    title: "Gestión de materiales",
    summary: "Cargar materiales, corregir precios y actualizarlos por inflación.",
  },
  {
    id: "presupuesto",
    title: "Armar el presupuesto a mano",
    summary: "Elegir del catálogo, poner la cantidad y sumar la línea.",
  },
  {
    id: "chat",
    title: "Usar el asistente (opcional)",
    summary: "Si preferís dictarlo, el asistente carga las líneas por vos.",
  },
  {
    id: "moneda",
    title: "Pesos, dólares y dólar blue",
    summary: "Ver el mismo presupuesto en $ o en u$s con la cotización del día.",
  },
  {
    id: "pdf",
    title: "Exportar y mandar el PDF",
    summary: "Descargar el presupuesto y compartirlo por WhatsApp.",
  },
  {
    id: "problemas",
    title: "Si algo no funciona",
    summary: "Qué mirar cuando el asistente no responde o no hay cotización.",
  },
];

/**
 * User documentation.
 *
 * This is a server component on purpose: the guide is plain content, so it
 * needs no client JavaScript to be readable, searchable or printable.
 */
export default function HelpGuide() {
  return (
    <div className="mx-auto max-w-3xl">
      <header className="mb-8">
        <p className="text-sm font-medium text-primary">Ayuda</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Cómo usar PreSupuesto</h1>
        <p className="mt-3 text-base text-muted">
          Una guía corta para armar presupuestos de obra sin vueltas. Si es la primera vez
          que entrás, empezá por los materiales: todo lo demás sale de ahí. Los
          presupuestos los armás a mano, y si querés te ayuda el asistente.
        </p>
      </header>

      <nav aria-labelledby="indice" className="mb-10 rounded-xl border border-border bg-surface p-5">
        <h2 id="indice" className="text-sm font-semibold">
          En esta guía
        </h2>
        <ol className="mt-3 space-y-2">
          {SECTIONS.map((section, index) => (
            <li key={section.id} className="text-sm">
              <a
                href={`#${section.id}`}
                className="font-medium text-primary underline-offset-4 hover:underline"
              >
                {index + 1}. {section.title}
              </a>
              <span className="ml-1 text-muted">— {section.summary}</span>
            </li>
          ))}
        </ol>
      </nav>

      <div className="space-y-12">
        {/* 1 ----------------------------------------------------------------- */}
        <GuideSection id="materiales" number={1} title="Gestión de materiales">
          <p>
            En <PageLink href="/materials">Materiales</PageLink> está tu catálogo: los
            nombres y las unidades con los que armás la lista de un presupuesto, más los
            precios que llevás de referencia.
          </p>
          <p>
            <strong>Esos precios no entran al presupuesto.</strong> Lo que salen los
            materiales lo manejás vos con el corralón; al cliente se le informa qué se va a
            comprar, no cuánto sale.
          </p>

          <Steps title="Para cargar un material nuevo">
            <li>
              Entrá a <strong>Materiales</strong> y tocá <Button>Agregar material</Button>.
            </li>
            <li>
              Completá el <strong>nombre</strong>, la <strong>categoría</strong>{" "}
              (Albañilería, Pintura, Materiales de agarre…), la <strong>unidad</strong>{" "}
              (bolsa, m2, u, balde) y el <strong>precio unitario</strong>.
            </li>
            <li>
              El <strong>código</strong> podés dejarlo vacío: se genera solo según la
              categoría, como <Code>MAT-ALB-004</Code> para Albañilería. Si preferís
              usar el tuyo, escribilo y se respeta.
            </li>
            <li>
              Tocá <Button>Crear material</Button>. Ya queda disponible para los
              presupuestos nuevos.
            </li>
          </Steps>

          <Steps title="Para corregir un precio suelto">
            <li>
              Buscá el material por nombre con el buscador, o filtrá por categoría.
            </li>
            <li>
              Tocá el precio en la columna <strong>Precio unit.</strong>: se convierte en
              un casillero editable.
            </li>
            <li>
              Escribí el precio nuevo y apretá <Key>Enter</Key>. Si te arrepentís, apretá{" "}
              <Key>Esc</Key> y queda como estaba.
            </li>
          </Steps>

          <Steps title="Para actualizar todos los precios por inflación">
            <li>
              Si querés tocar una sola categoría, elegila primero en{" "}
              <strong>Todas las categorías</strong>. Si no elegís ninguna, se actualiza
              todo el catálogo.
            </li>
            <li>
              En <strong>Actualización rápida de precios</strong>, escribí el porcentaje.
              Por ejemplo <Code>15</Code> para aumentar un 15%.
            </li>
            <li>
              Tocá <Button>Aplicar</Button> y confirmá. El cartel te dice cuántos precios
              cambiaron.
            </li>
          </Steps>

          <Callout title="Tené en cuenta">
            <ul className="list-disc space-y-1 pl-5">
              <li>
                Para <strong>bajar</strong> precios, usá un número negativo:{" "}
                <Code>-10</Code> los baja un 10%.
              </li>
              <li>
                El aumento se aplica solo a los materiales <strong>activos</strong>.
              </li>
              <li>
                Los presupuestos ya guardados <strong>no cambian</strong>: cada uno se
                queda con los precios del día que lo armaste.
              </li>
              <li>
                Un material que ya usó un presupuesto no se puede eliminar. Editalo y
                destildá <strong>Activo</strong>: deja de aparecer en los nuevos, pero los
                viejos siguen enteros.
              </li>
            </ul>
          </Callout>
        </GuideSection>

        {/* 2 ----------------------------------------------------------------- */}
        <GuideSection id="presupuesto" number={2} title="Armar el presupuesto a mano">
          <p>
            Esta es la forma principal de trabajar. En el{" "}
            <PageLink href="/">Escritorio</PageLink>, arriba de todo está el formulario
            para sumar líneas, y abajo el presupuesto que se va armando.
          </p>

          <p>
            Hay tres formas de sumar una línea, y elegís cuál con los botones de arriba a
            la derecha del formulario: <strong>Partida</strong>, <strong>Mano de obra</strong>{" "}
            y <strong>Lista</strong>.
          </p>

          <Steps title="Partida: describís el trabajo y ponés el precio">
            <li>
              En <strong>Trabajo</strong> escribí qué vas a hacer, como se lo contarías al
              cliente: <em>&ldquo;Demoler la pared que está más alta que el techo&rdquo;</em>.
            </li>
            <li>
              En <strong>Precio del trabajo</strong> va el número entero, con puntos o sin
              ellos: <Code>1.600.000</Code> o <Code>1600000</Code>, lo mismo da.
            </li>
            <li>
              En <strong>Qué incluye</strong> podés poner, <strong>una por renglón</strong>,
              las cosas que entran en ese precio. Salen como viñetas abajo del título, en la
              pantalla y en el PDF.
            </li>
            <li>
              En <strong>Aclaración</strong> va lo que condiciona el precio:{" "}
              <em>&ldquo;con las restricciones de la administración&rdquo;</em>. Se imprime
              en bastardilla al lado de la partida.
            </li>
          </Steps>

          <Steps title="Mano de obra: cobrás por cantidad">
            <li>
              Escribí en <strong>Tarea de mano de obra</strong> lo que buscás: sirve el
              nombre, el rubro o el código. Los materiales no aparecen acá —{" "}
              <strong>no se cobran en el presupuesto</strong>, van en la Lista.
            </li>
            <li>
              Tocá el que quieras de la lista. Si apretás <Key>Enter</Key>, se elige el
              primero.
            </li>
            <li>
              Poné la <strong>cantidad</strong> en la unidad que te muestra (m2, u, ml…).
            </li>
            <li>
              Tocá <Button>Agregar al presupuesto</Button>. La línea aparece abajo y los
              totales se recalculan solos.
            </li>
          </Steps>

          <Callout title="Mientras armás">
            <ul className="list-disc space-y-1 pl-5">
              <li>
                Antes de agregar, abajo del formulario ves cuánto suma esa línea.
              </li>
              <li>
                Para corregir una cantidad, tocá el número de la línea (el que está
                subrayado con puntitos), escribí el nuevo y apretá <Key>Enter</Key>. Con{" "}
                <Key>Esc</Key> queda como estaba.
              </li>
              <li>
                Para sacar algo, tocá la <strong>✕</strong> a la derecha de la línea.
              </li>
              <li>
                <Button>Nuevo</Button> arranca un presupuesto vacío; el anterior queda
                guardado.
              </li>
              <li>
                Los precios se copian del catálogo en el momento de agregar, así que un
                aumento posterior no te cambia este presupuesto.
              </li>
            </ul>
          </Callout>

          <Callout title="Materiales que compra el cliente">
            <p>
              Elegí el modo <strong>Lista</strong>. Escribí el material, y si querés la
              cantidad y la unidad: <em>3 m3 de arena fina</em>. Pero si es algo que no se
              mide —<em>madera</em>, <em>cerámica, adhesivo y pastina</em>— dejá los dos
              casilleros vacíos y va solo el nombre.
            </p>
            <p className="mt-2">
              <strong>Nunca se le pone precio.</strong> Es la lista que le dejás al cliente
              para que vaya al corralón: aparece en <strong>A cargo del cliente</strong> y, en
              el PDF, al final bajo <em>MATERIALES A CARGO DEL CLIENTE</em>, aclarando que no
              está incluida en el total.
            </p>
            <p className="mt-2">
              Si un material que estabas cobrando pasa a comprarlo el cliente, tocá el{" "}
              <strong>☰</strong> de la línea: se va a la lista y deja de sumar.
            </p>
          </Callout>

          <Callout title="Lo que cambia el precio">
            <p>
              Abajo del presupuesto está <strong>Condiciones de obra</strong>. Marcá lo que
              corresponda —departamento, sin lugar para estacionar, horarios impuestos— y{" "}
              <strong>los precios suben solos</strong>: una partida de <Code>1.600.000</Code>{" "}
              con departamento pasa a <Code>2.240.000</Code>. Los porcentajes se suman entre
              sí, y los cambiás tocándolos.
            </p>
            <p className="mt-2">
              <strong>Compra de materiales</strong> es distinto: no cambia ningún número,
              porque cuánto salen los materiales lo sabés vos, no el sistema. Elegí{" "}
              <strong>Provincia</strong> o <strong>Capital</strong> —son alternativas, nunca
              las dos— y el PDF lo aclara con una frase:{" "}
              <em>&ldquo;Por la compra de materiales se cobra un 15% del valor de los
              mismos&rdquo;</em>.
            </p>
            <p className="mt-2">
              <strong>El cliente no ve ningún porcentaje.</strong> El recargo queda repartido
              adentro de los precios, así que las líneas siempre suman el total. Si destildás
              una condición, todo vuelve a como estaba: lo que se guarda es el precio base.
            </p>
          </Callout>

          <Callout title="Para quién es">
            <p>
              Abajo del estado dice <strong>Cliente</strong>. Mientras no elijas a nadie
              queda en <em>Consumidor final</em>: tocá <Button>Elegir</Button> y buscalo
              por nombre, o cargalo ahí mismo con{" "}
              <Button>+ Cargar un cliente nuevo</Button> (alcanza con el nombre; el
              teléfono, el mail y la dirección son opcionales). El nombre y los datos que
              cargues son los que salen en el PDF.
            </p>
          </Callout>

          <Callout title="Volver a uno de antes">
            <p>
              En <PageLink href="/presupuestos">Presupuestos</PageLink> tenés todos los que
              guardaste, del más nuevo al más viejo, con su fecha, su estado y su total. Tocá{" "}
              <Button>Abrir</Button> para seguir editando uno, o <Button>PDF</Button> para
              bajarlo de nuevo sin abrirlo.
            </p>
          </Callout>
        </GuideSection>

        {/* 3 ----------------------------------------------------------------- */}
        <GuideSection id="chat" number={3} title="Usar el asistente (opcional)">
          <p>
            Si te resulta más cómodo dictarlo que cargarlo, abrí{" "}
            <Button>🤖 Asistente IA</Button> en el Escritorio (en el celular es la
            solapa <strong>🤖 Asistente</strong>). Escribile como le hablarías a alguien
            del oficio: busca los precios en tu catálogo y hace las cuentas. Todo lo que
            cargue va al mismo presupuesto que armás a mano.
          </p>

          <Steps title="Para calcular un trabajo">
            <li>Escribí qué hay que hacer, con las medidas.</li>
            <li>
              Apretá <Key>Enter</Key> para enviar. Con <Key>Shift</Key> + <Key>Enter</Key>{" "}
              hacés un salto de línea.
            </li>
            <li>
              Leé el detalle que te devuelve y pedile los cambios que necesites: es una
              conversación, se acuerda de lo anterior.
            </li>
            <li>
              Cuando esté bien, pedile que lo guarde. Las líneas aparecen en el mismo
              presupuesto, al lado de las que cargaste a mano.
            </li>
          </Steps>

          <div>
            <h3 className="text-sm font-semibold">Ejemplos para copiar</h3>
            <ul className="mt-3 space-y-2">
              {[
                "Pared de ladrillo común de 3x2,5 m",
                "Presupuestá 15 m² de piso de porcelanato con 10% de desperdicio",
                "¿Qué materiales tenés para albañilería y a cuánto están?",
                "Agregale 2 bocas de luz y una boca de agua",
                "Sumale 10% de desperdicio a los ladrillos",
                "Guardalo como presupuesto para Ana Torres",
              ].map((example) => (
                <li
                  key={example}
                  className="rounded-lg border border-border bg-surface-muted px-4 py-2.5 text-sm"
                >
                  “{example}”
                </li>
              ))}
            </ul>
          </div>

          <Callout title="Para que salga mejor">
            <ul className="list-disc space-y-1 pl-5">
              <li>
                Dale <strong>medidas concretas</strong>: metros cuadrados, cantidad de
                bocas, largo de la pared.
              </li>
              <li>
                Si el material no está en el catálogo, no lo va a inventar. Cargalo primero
                en <PageLink href="/materials">Materiales</PageLink>.
              </li>
              <li>
                Para guardar un presupuesto necesita un cliente. Si es nuevo, pedile que lo
                cree con nombre y teléfono.
              </li>
              <li>
                El cartel <strong>Respaldo Gemini</strong> arriba del chat significa que
                contestó el asistente de respaldo. Funciona igual.
              </li>
            </ul>
          </Callout>
        </GuideSection>

        {/* 4 ----------------------------------------------------------------- */}
        <GuideSection id="moneda" number={4} title="Pesos, dólares y dólar blue">
          <p>
            Arriba a la derecha, al lado del menú, está la cotización del{" "}
            <strong>dólar blue</strong> con la compra y la venta del momento. El botón
            circular la vuelve a consultar cuando quieras.
          </p>

          <Steps title="Para ver un presupuesto en dólares">
            <li>
              En la tarjeta del presupuesto, tocá <Button>u$s</Button> (al lado de{" "}
              <Button>Actualizar</Button>).
            </li>
            <li>
              Todos los importes pasan a dólares: materiales, mano de obra, subtotal, IVA y
              total.
            </li>
            <li>
              Abajo del total vas a ver a cuánto equivale en pesos y con qué cotización se
              hizo la cuenta.
            </li>
            <li>
              Para volver a pesos, tocá <Button>$</Button>.
            </li>
          </Steps>

          <Callout title="Cómo se hace la cuenta">
            <ul className="list-disc space-y-1 pl-5">
              <li>
                Se usa el valor de <strong>venta</strong> del blue, que es el que se paga
                para comprar dólares.
              </li>
              <li>
                Los precios se guardan siempre <strong>en pesos</strong>. Los dólares son
                una forma de mirarlos, no cambian nada en el sistema.
              </li>
              <li>
                Como la cotización se mueve, el mismo presupuesto puede dar otro número en
                u$s mañana. Por eso el PDF deja escrita la cotización que se usó.
              </li>
              <li>
                Si el botón <Button>u$s</Button> aparece apagado, es que en ese momento no
                hay cotización disponible. Probá con el botón de actualizar.
              </li>
            </ul>
          </Callout>
        </GuideSection>

        {/* 5 ----------------------------------------------------------------- */}
        <GuideSection id="pdf" number={5} title="Exportar y mandar el PDF">
          <p>
            El PDF es el documento que le mandás al cliente: sale con tus datos, los del
            cliente, el detalle de materiales y mano de obra, y el total.
          </p>

          <Steps title="Para descargarlo">
            <li>
              Elegí primero la moneda: si lo querés en dólares, dejá el botón en{" "}
              <Button>u$s</Button>.
            </li>
            <li>
              Tocá <Button>Exportar PDF</Button>. El archivo se descarga con un nombre como{" "}
              <Code>presupuesto-0001-refaccion-de-cocina.pdf</Code>.
            </li>
            <li>
              Queda en la carpeta <strong>Descargas</strong> de tu computadora o teléfono.
            </li>
          </Steps>

          <Steps title="Para mandarlo por WhatsApp">
            <li>
              <strong>Desde la computadora:</strong> abrí{" "}
              <a
                href="https://web.whatsapp.com"
                target="_blank"
                rel="noreferrer"
                className="font-medium text-primary underline-offset-4 hover:underline"
              >
                WhatsApp Web
              </a>
              , entrá al chat del cliente y tocá el clip 📎 → <strong>Documento</strong>.
            </li>
            <li>
              Elegí el PDF en <strong>Descargas</strong> y enviá.
            </li>
            <li>
              <strong>Desde el teléfono:</strong> abrí el archivo en Descargas, tocá{" "}
              <strong>Compartir</strong> y elegí WhatsApp y el contacto.
            </li>
          </Steps>

          <Callout title="Un detalle importante">
            Si lo exportás en u$s, el PDF aclara arriba la{" "}
            <strong>cotización aplicada</strong> y avisa que puede variar hasta que el
            cliente acepte. Así nadie discute después de dónde salió el número.
          </Callout>
        </GuideSection>

        {/* 6 ----------------------------------------------------------------- */}
        <GuideSection id="problemas" number={6} title="Si algo no funciona">
          <dl className="space-y-4">
            <Problem question="El asistente no contesta o tira error">
              Probá de nuevo en un rato. Si sigue igual, avisale a quien te instaló el
              sistema: puede estar apagado el servicio del asistente.
            </Problem>
            <Problem question="Dice “Sin cotización” arriba">
              No se pudo consultar el dólar blue. Tocá el botón de actualizar; mientras
              tanto podés seguir trabajando en pesos.
            </Problem>
            <Problem question="No me deja eliminar un material">
              Es porque ya lo usa un presupuesto guardado. Editalo y destildá{" "}
              <strong>Activo</strong>.
            </Problem>
            <Problem question="Los precios me quedaron mal después de un aumento">
              Aplicá el porcentaje al revés para volver atrás (si subiste 10%, aplicá{" "}
              <Code>-9,1</Code>) o corregí a mano los que estén mal. Conviene revisar antes
              de confirmar.
            </Problem>
          </dl>
        </GuideSection>
      </div>

      <footer className="mt-12 rounded-xl border border-border bg-surface-muted p-5 text-sm text-muted">
        ¿Te quedó una duda que la guía no responde? Anotala y pedísela a quien te armó el
        sistema: esta página se puede ampliar.
      </footer>
    </div>
  );
}

/** A numbered section with a heading the index can link to. */
function GuideSection({
  id,
  number,
  title,
  children,
}: {
  id: string;
  number: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    // scroll-mt keeps the heading clear of the sticky header when linked to.
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-24">
      <h2 id={`${id}-title`} className="flex items-center gap-3 text-xl font-semibold tracking-tight">
        <span
          aria-hidden
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-sm font-bold text-primary"
        >
          {number}
        </span>
        {title}
      </h2>
      <div className="mt-4 space-y-5 text-sm leading-relaxed text-foreground">{children}</div>
    </section>
  );
}

/** A titled list of ordered steps. */
function Steps({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-sm font-semibold">{title}</h3>
      <ol className="mt-3 list-decimal space-y-2 pl-5 marker:font-semibold marker:text-primary">
        {children}
      </ol>
    </div>
  );
}

/** An aside with tips or warnings. */
function Callout({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <aside className="rounded-xl border border-border bg-surface p-4">
      <p className="text-sm font-semibold">{title}</p>
      <div className="mt-2 text-sm text-muted">{children}</div>
    </aside>
  );
}

/** One question and answer in the troubleshooting list. */
function Problem({ question, children }: { question: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <dt className="text-sm font-semibold">{question}</dt>
      <dd className="mt-1 text-sm text-muted">{children}</dd>
    </div>
  );
}

/** Reference to a button the reader has to find on screen. */
function Button({ children }: { children: React.ReactNode }) {
  return (
    <span className="whitespace-nowrap rounded-md bg-primary-soft px-1.5 py-0.5 text-xs font-semibold text-primary">
      {children}
    </span>
  );
}

/** Reference to a key on the keyboard. */
function Key({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-border bg-surface-muted px-1.5 py-0.5 font-mono text-xs">
      {children}
    </kbd>
  );
}

/** A literal value the reader can type. */
function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-surface-muted px-1.5 py-0.5 font-mono text-xs">{children}</code>
  );
}

/** Link to another view of the application. */
function PageLink({
  href,
  children,
}: {
  href: "/" | "/materials" | "/presupuestos";
  children: React.ReactNode;
}) {
  return (
    <Link href={href} className="font-medium text-primary underline-offset-4 hover:underline">
      {children}
    </Link>
  );
}

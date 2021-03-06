/// <reference path="../../localtypings/smoothie.d.ts" />

import * as React from "react"
import * as pkg from "./package"
import * as core from "./core"
import * as srceditor from "./srceditor"
import * as sui from "./sui"
import * as codecard from "./codecard"
import * as data from "./data";

import Cloud = pxt.Cloud
import Util = pxt.Util

const lf = Util.lf
const maxEntriesPerChart: number = 4000;

export class Editor extends srceditor.Editor {
    savedMessageQueue: pxsim.SimulatorSerialMessage[] = []
    maxSavedMessages: number = 1000;
    charts: Chart[] = []
    chartIdx: number = 0
    sourceMap: pxt.Map<string> = {}
    consoleBuffer: string = ""
    isSim: boolean = true
    maxConsoleLineLength: number = 255;
    maxConsoleEntries: number = 500;
    active: boolean = true

    lineColors = ["#f00", "#00f", "#0f0", "#ff0"]
    hcLineColors = ["000"]
    currentLineColors = this.lineColors
    highContrast: boolean = false

    //refs
    startPauseButton: StartPauseButton
    consoleRoot: HTMLElement
    chartRoot: HTMLElement

    getId() {
        return "serialEditor"
    }

    hasHistory() { return false; }

    hasEditorToolbar() {
        return false
    }

    setVisible(b: boolean) {
        if (this.parent.state.highContrast !== this.highContrast) {
            this.setHighContrast(this.parent.state.highContrast)
        }
        this.isVisible = b
        if (this.isVisible) {
            this.processQueuedMessages()
            this.startRecording()
        }
        else {
            this.pauseRecording()
            this.clear()
        }
    }

    setHighContrast(hc: boolean) {
        if (hc !== this.highContrast) {
            this.highContrast = hc;
            if (hc) {
                this.currentLineColors = this.hcLineColors
            } else {
                this.currentLineColors = this.lineColors
            }
            this.clear()
        }
    }

    acceptsFile(file: pkg.File) {
        return file.name === pxt.SERIAL_EDITOR_FILE;
    }

    setSim(b: boolean) {
        if (this.isSim != b) {
            this.isSim = b
            this.clear()
        }
    }

    constructor(public parent: pxt.editor.IProjectView) {
        super(parent)
        window.addEventListener("message", this.processEvent.bind(this), false)
        const serialTheme = pxt.appTarget.serial && pxt.appTarget.serial.editorTheme;
        this.lineColors = (serialTheme && serialTheme.lineColors) || this.lineColors;
    }

    saveMessageForLater(m: pxsim.SimulatorSerialMessage) {
        this.savedMessageQueue.push(m);
        if (this.savedMessageQueue.length > this.maxSavedMessages) {
            this.savedMessageQueue.shift();
        }
    }

    processQueuedMessages() {
        this.savedMessageQueue.forEach(m => this.processMessage(m));
        this.savedMessageQueue = [];
    }

    processEvent(ev: MessageEvent) {
        let msg = ev.data
        if (msg.type !== "serial") return;
        const smsg = msg as pxsim.SimulatorSerialMessage

        smsg.receivedTime = smsg.receivedTime || Util.now();
        if (!this.active) {
            this.saveMessageForLater(smsg);
            return;
        }
        this.processMessage(smsg);
    }

    processMessage(smsg: pxsim.SimulatorSerialMessage) {
        const sim = !!smsg.sim
        if (sim != this.isSim) return;

        const data = smsg.data || ""
        const source = smsg.id || "?"
        const receivedTime = smsg.receivedTime || Util.now()

        if (!this.sourceMap[source]) {
            let sourceIdx = Object.keys(this.sourceMap).length + 1
            this.sourceMap[source] = lf("source") + sourceIdx.toString()
        }
        let niceSource = this.sourceMap[source]

        const m = /^\s*(([^:]+):)?\s*(-?\d+(\.\d*)?)/i.exec(data);
        if (m) {
            const variable = m[2] || '';
            const nvalue = parseFloat(m[3]);
            if (!isNaN(nvalue)) {
                this.appendGraphEntry(niceSource, variable, nvalue, receivedTime)
                return;
            }
        }

        this.appendConsoleEntry(data)
    }

    appendGraphEntry(source: string, variable: string, nvalue: number, receivedTime: number) {
        //See if there is a "home chart" that this point belongs to -
        //if not, create a new chart
        let homeChart: Chart = undefined
        for (let i = 0; i < this.charts.length; ++i) {
            let chart = this.charts[i]
            if (chart.shouldContain(source, variable)) {
                homeChart = chart
                break
            }
        }
        if (!homeChart) {
            homeChart = new Chart(source, variable, this.chartIdx, this.currentLineColors)
            this.chartIdx++;
            this.charts.push(homeChart)
            this.chartRoot.appendChild(homeChart.getElement());
        }
        homeChart.addPoint(variable, nvalue, receivedTime)
    }

    appendConsoleEntry(data: string) {
        for (let i = 0; i < data.length; ++i) {
            let ch = data[i]
            this.consoleBuffer += ch
            if (ch !== "\n" && this.consoleBuffer.length < this.maxConsoleLineLength) {
                continue
            }
            if (ch === "\n") {
                let lastEntry = this.consoleRoot.lastChild
                let newEntry = document.createElement("div")
                if (lastEntry && lastEntry.lastChild.textContent == this.consoleBuffer) {
                    if (lastEntry.childNodes.length == 2) {
                        //Matches already-collapsed entry
                        let count = parseInt(lastEntry.firstChild.textContent)
                        lastEntry.firstChild.textContent = (count + 1).toString()
                    } else {
                        //Make a new collapsed entry with count = 2
                        let newLabel = document.createElement("a")
                        newLabel.className = "ui horizontal label"
                        newLabel.textContent = "2"
                        lastEntry.insertBefore(newLabel, lastEntry.lastChild)
                    }
                } else {
                    //Make a new non-collapsed entry
                    newEntry.appendChild(document.createTextNode(this.consoleBuffer))
                    this.consoleRoot.appendChild(newEntry)
                }
            } else {
                //Buffer is full
                //Make a new entry with <span>, not <div>
                let newEntry = document.createElement("span")
                newEntry.appendChild(document.createTextNode(this.consoleBuffer))
                this.consoleRoot.appendChild(newEntry)
            }
            this.consoleBuffer = ""
            this.consoleRoot.scrollTop = this.consoleRoot.scrollHeight
            if (this.consoleRoot.childElementCount > this.maxConsoleEntries) {
                this.consoleRoot.removeChild(this.consoleRoot.firstChild)
            }
            if (this.consoleRoot && this.consoleRoot.childElementCount > 0) {
                if (this.chartRoot) this.chartRoot.classList.remove("noconsole");
                if (this.consoleRoot) this.consoleRoot.classList.remove("noconsole");
            }
        }
    }

    pauseRecording() {
        this.active = false
        if (this.startPauseButton) this.startPauseButton.setState({ active: this.active });
        this.charts.forEach(s => s.stop())
    }

    startRecording() {
        this.active = true
        if (this.startPauseButton) this.startPauseButton.setState({ active: this.active });
        this.charts.forEach(s => s.start())
    }

    toggleRecording() {
        pxt.tickEvent("serial.toggleRecording", undefined, { interactiveConsent: true })
        if (this.active) this.pauseRecording()
        else this.startRecording()
    }

    clearNode(e: HTMLElement) {
        while (e.hasChildNodes()) {
            e.removeChild(e.firstChild)
        }
    }

    clear() {
        if (this.chartRoot) {
            this.clearNode(this.chartRoot);
            this.chartRoot.classList.add("noconsole")
        }
        if (this.consoleRoot) {
            this.clearNode(this.consoleRoot);
            this.consoleRoot.classList.add("noconsole")
        }
        this.charts = []
        this.consoleBuffer = ""
        this.savedMessageQueue = []
        this.sourceMap = {}
    }

    downloadCSV() {
        const sep = lf("{id:csvseparator}\t");
        const lines: { name: string; line: number[][]; }[] = [];
        this.charts.forEach(chart => Object.keys(chart.datas).forEach(k => lines.push({ name: `${k} (${chart.source})`, line: chart.datas[k] })));
        let csv = `sep=${sep}\r\n` +
            lines.map(line => `time (s)${sep}${line.name}`).join(sep) + '\r\n';

        const datas = lines.map(line => line.line);
        const nl = datas.map(data => data.length).reduce((l, c) => Math.max(l, c));
        const nc = this.charts.length;
        for (let i = 0; i < nl; ++i) {
            csv += datas.map(data => i < data.length ? `${(data[i][0] - data[0][0]) / 1000}${sep}${data[i][1]}` : sep).join(sep);
            csv += '\r\n';
        }

        core.infoNotification(lf("Exporting data...."));
        const time = new Date(Date.now()).toString().replace(/[^\d]+/g, '-').replace(/(^-|-$)/g, '');
        pxt.commands.browserDownloadAsync(csv, pxt.appTarget.id + '-' + lf("{id:csvfilename}data") + '-' + time + ".csv", "text/csv")
    }

    goBack() {
        pxt.tickEvent("serial.backButton", undefined, { interactiveConsent: true })
        this.parent.openPreviousEditor()
    }

    display() {
        return (
            <div id="serialArea">
                <div id="serialHeader" className="ui">
                    <div className="leftHeaderWrapper">
                        <div className="leftHeader">
                            <sui.Button title={lf("Go back")} class="ui icon circular small button editorBack" ariaLabel={lf("Go back")} onClick={this.goBack.bind(this)}>
                                <sui.Icon icon="arrow left" />
                            </sui.Button>
                        </div>
                    </div>
                    <div className="rightHeader">
                        <sui.Button title={lf("Export data")} class="ui icon blue button editorExport" ariaLabel={lf("Export data")} onClick={() => this.downloadCSV()}>
                            <sui.Icon icon="download" />
                        </sui.Button>
                        <StartPauseButton ref={e => this.startPauseButton = e} active={this.active} toggle={this.toggleRecording.bind(this)} />
                        <span className="ui small header">{this.isSim ? lf("Simulator") : lf("Device")}</span>
                    </div>
                </div>
                <div id="serialCharts" className="noconsole" ref={e => this.chartRoot = e}></div>
                <div id="serialConsole" className="noconsole" ref={e => this.consoleRoot = e}></div>
            </div>
        )
    }

    domUpdate() {
    }
}

export interface StartPauseButtonProps {
    active?: boolean;
    toggle?: () => void;
}

export interface StartPauseButtonState {
    active?: boolean;
}

export class StartPauseButton extends data.Component<StartPauseButtonProps, StartPauseButtonState> {
    constructor(props: StartPauseButtonProps) {
        super(props);
        this.state = {
            active: this.props.active
        }
    }

    renderCore() {
        const { toggle } = this.props;
        const { active } = this.state;

        return <sui.Button title={active ? lf("Pause recording") : lf("Start recording")} class={`ui left floated icon button ${active ? "green" : "red circular"} toggleRecord`} onClick={toggle}>
            <sui.Icon icon={active ? "pause icon" : "circle icon"} />
        </sui.Button>
    }
}

class Chart {
    rootElement: HTMLElement = document.createElement("div")
    lineColors: string[];
    chartIdx: number;
    canvas: HTMLCanvasElement;
    label: HTMLDivElement;
    lines: pxt.Map<TimeSeries> = {};
    datas: pxt.Map<number[][]> = {};
    source: string;
    variable: string;
    chart: SmoothieChart;

    constructor(source: string, variable: string, chartIdx: number, lineColors: string[]) {
        // Initialize chart
        const serialTheme = pxt.appTarget.serial && pxt.appTarget.serial.editorTheme;
        const chartConfig: IChartOptions = {
            interpolation: 'bezier',
            labels: {
                disabled: false,
                fillStyle: 'black',
                fontSize: 14
            },
            responsive: true,
            millisPerPixel: 20,
            grid: {
                verticalSections: 0,
                borderVisible: false,
                millisPerLine: 5000,
                fillStyle: serialTheme && serialTheme.gridFillStyle || 'transparent',
                strokeStyle: serialTheme && serialTheme.gridStrokeStyle || '#fff'
            },
            tooltip: true,
            tooltipFormatter: (ts, data) => this.tooltip(ts, data)
        }
        this.lineColors = lineColors;
        this.chartIdx = chartIdx;
        this.chart = new SmoothieChart(chartConfig);
        this.rootElement.className = "ui segment";
        this.source = source;
        this.variable = variable.replace(/\..*$/, ''); // keep prefix only

        this.rootElement.appendChild(this.makeLabel())
        this.rootElement.appendChild(this.makeCanvas())
    }

    tooltip(timestamp: number, data: { series: TimeSeries, index: number, value: number }[]): string {
        return data.map(n => {
            const name = (n.series as any).timeSeries.__name;
            return `<span>${name ? name + ': ' : ''}${n.value}</span>`;
        }).join('<br/>');
    }

    getLine(name: string): TimeSeries {
        let line = this.lines[name];
        if (!line) {
            const lineColor = this.lineColors[this.chartIdx++ % this.lineColors.length]
            this.lines[name] = line = new TimeSeries();
            (line as any).__name = Util.htmlEscape(name.substring(this.variable.length + 1));
            this.chart.addTimeSeries(line, {
                strokeStyle: lineColor,
                lineWidth: 3
            })
            this.datas[name] = [];
        }
        return line;
    }

    makeLabel() {
        this.label = document.createElement("div")
        this.label.className = "ui orange bottom left attached no-select label seriallabel"
        this.label.innerText = this.variable || "...";
        return this.label;
    }

    makeCanvas() {
        let canvas = document.createElement("canvas");
        this.chart.streamTo(canvas);
        this.canvas = canvas;
        return canvas
    }

    getCanvas() {
        return this.canvas
    }

    getElement() {
        return this.rootElement
    }

    shouldContain(source: string, variable: string) {
        return this.source == source
            && this.variable == variable.replace(/\..*$/, '');
    }

    addPoint(name: string, value: number, timestamp: number) {
        const line = this.getLine(name);
        line.append(timestamp, value)
        if (Object.keys(this.lines).length == 1) {
            // update label with last value
            const valueText = Number(Math.round(Number(value + "e+2")) + "e-2").toString();
            this.label.innerText = this.variable ? `${this.variable}: ${valueText}` : valueText;
        } else {
            this.label.innerText = this.variable || '';
        }
        // store data
        const data = this.datas[name];
        data.push([timestamp, value]);
        // remove a third of the card
        if (data.length > maxEntriesPerChart)
            data.splice(0, data.length / 4);
    }

    start() {
        this.chart.start()
    }

    stop() {
        this.chart.stop()
    }
}

export class ResourceImporter implements pxt.editor.IResourceImporter {
    public id: "console";
    public canImport(data: File): boolean {
        return data.type == "text/plain";
    }

    public importAsync(project: pxt.editor.IProjectView, data: File): Promise<void> {
        return ts.pxtc.Util.fileReadAsTextAsync(data)
            .then(txt => {
                if (!txt) {
                    core.errorNotification(lf("Ooops, could not read file"));
                    return;
                }

                // parse times
                const lines = txt.split(/\n/g).map(line => {
                    // extract timespace
                    const t = /^\s*(\d+)>/.exec(line);
                    if (t) line = line.substr(t[0].length);
                    return {
                        type: "serial",
                        data: line + "\n",
                        id: data.name,
                        receivedTime: t ? parseFloat(t[1]) : undefined
                    } as pxsim.SimulatorSerialMessage;
                })
                if (!lines.length)
                    return;

                // normalize timestamps
                const now = Util.now();
                const linest = lines.filter(line => !!line.receivedTime);
                if (linest.length) {
                    const tmax = linest[linest.length - 1].receivedTime || 0;
                    linest.forEach(line => line.receivedTime += now - tmax);
                }

                // show console

                // send as serial message
                lines.forEach(line => window.postMessage(line, "*"));
            });
    }
}

/*  
    -------------------------------------
	it is a prototype / proof-of-concept
    this code is looks like a big shit :)
	-------------------------------------
*/

var elements_found = 0;

function to_hex(buffer) {
    /* https://stackoverflow.com/questions/40031688/javascript-arraybuffer-to-hex/50767210#50767210 */
    return [ ...new Uint8Array(buffer) ]
        .map (b => b.toString(16).padStart(2, "0"))
        .join ("");
}
function to_dec(buffer) {
    return parseInt(buffer, 16);
}
function getUUID(buffer) {
    return to_hex(
        buffer
    ).toLowerCase();
}
/*
   -----------------------------------------------------
        Read BER and return data size and ber size
   -----------------------------------------------------
*/
function getBER(buffer) {
    /*
    ------------------------------------------------------------------------
    SMPTE.EG.0377-3-2013 - MXF Engineering Guideline.pdf - Page 11
    40h                       ->  short form coded
    83.00.00.40               ->  long form coding using 4 bytes overall
    87.00.00.00.00.00.00.40   ->  long form coding using 8 bytes overall
    ------------------------------------------------------------------------
    using (80 - BER) = number of bytes to be readed after
    ex:    <81 = the size value is the BER
    ex:  80-81 = 1 byte after is the size value
    ex:  80-83 = 3 bytes after are the size value
    ex:  80-87 = 7 bytes after are the size value
    ------------------------------------------------------------------------
    */
    console.log("[debug] [getber] buffer =", to_hex(buffer));
    let ber_code = buffer.slice(0, 1);
    let ber_int = new Uint8Array(ber_code);
    let ber_size = ber_int - 128; // 0x{81-87} - 0x80 = {1...7}
    let ber_value = 0;
    let data_size = 0;
    console.log("[debug] [getber] ber size =", ber_size);
    if (ber_size > 0 && ber_size < 8) {
        console.log("[debug] [getber] long ber =", to_hex(ber_code));
        ber_value = buffer.slice(1, 1 + ber_size);
        data_size = to_dec(to_hex(ber_value));
        ber_size = 1 + ber_size;
    } else {
        console.log("[debug] [getber] short ber =", to_hex(ber_code));
        ber_value = buffer.slice(0, 1);
        data_size = to_dec(to_hex(ber_value));
        ber_size = 1;
    }
    return ({data_size, ber_size});
}

/*
   ------------------------------
        Manage click an KLV
   ------------------------------
*/
window.addEventListener("DOMContentLoaded", (event) => {
    document.querySelector('div#elements-list').addEventListener('click', (event) => {
        if( event.target.matches("div.element") ) {
            console.log("[debug] [domcontentloaded]", event.target);
        }
    });
});

/*
   ------------------------------
        Manage the interface
   ------------------------------
*/
document.addEventListener('interface', event => {

    switch(event.detail.action) {

            case 'reset':
                    elements_found = 0;
                    document.getElementById("progression").innerHTML = "0 %";
                    document.getElementById("elements-found").innerHTML = "0 elements found";
                    document.getElementById("elements-blocks").innerHTML = null;
                    document.getElementById("elements-list").innerHTML = null;
                    document.getElementById("informations").innerHTML = null;
                break

            case 'abort':
                    document.getElementById("informations").innerHTML = event.detail.reason;
                break

            case 'update':
                    // Create a new element
                    div = document.createElement("div");
                    div.setAttribute("id", event.detail.offset);
                    div.setAttribute("class", "element uuid_" + event.detail.uuid);
                    div.setAttribute("data-offset", event.detail.offset);
                    div.setAttribute("data-size", event.detail.size);
                    div.appendChild(
                        document.createTextNode(event.detail.uuid + " - " + event.detail.offset + " - " + event.detail.size)
                    );
                    // Add element into the list
                    document.getElementById("elements-list").appendChild(div);

                    /* Blocks */
                    div = document.createElement("div");
                    div.setAttribute("class", "uuid_" + event.detail.uuid);
                    document.getElementById("elements-blocks").appendChild(div);

                    // Update progression
                    document.getElementById("progression").innerHTML = Math.ceil( (event.detail.offset * 100) / event.detail.fileSize ) + " %";
                    document.getElementById("elements-found").innerHTML = (++elements_found) + " elements found";
                break

    } // switch

}, false);

/*
   ---------------------------------------
        Easy way to update interface
   ---------------------------------------
*/
function updateInterface(action, details = {}) {
    details['action'] = action;
    document.dispatchEvent(
        new CustomEvent("interface", { detail: details })
    );
};


function onDropHandler(event) {

    event.stopPropagation();
    event.preventDefault();

    updateInterface("reset");

    var files = event.dataTransfer.files;
    var file = files[0];

    var offset = 0;

    /*
        -----------------------------
            Read Data 
        -----------------------------
    */
    var readDataHandler = function(event) {
        uuid = getUUID(event.target.result.slice(0, 16));
        console.log("[debug] [readdata]", "uuid =", uuid, "size =", event.target.result.byteLength);
    }

    /*
        -----------------------------
            Read Header (only)
        -----------------------------
    */
    var readHeaderHandler = function(event) {

        let uuid = getUUID(event.target.result.slice(0, 16));
        let ber = getBER(event.target.result.slice(16, 24));

        console.log(
            "[debug] [readheader]", 
            "uuid =", uuid, 
            "offset.current =", offset,
            "ber_size =", ber.ber_size,
            "data_size =", ber.data_size,
            "offset.next =", (offset + 16 + ber.ber_size + ber.data_size) 
        );
        
        // Update interface : not a mxf
        if ( offset == 0 && ( uuid.slice(0, 8) != "060e2b34" ) ) {
            updateInterface("abort", { reason : "Not a MXF file" });
            console.log("[debug] [readheader] not a mxf");
            return
        }
        // Update interface : end of File
        if ( offset >= file.size ) {
            updateInterface("abort", { reason: "End of file" });
            console.log("[debug] [readheader] end of file");
            return
        }
        // Update interface : drift detected
        if ( uuid.slice(0, 8) != "060e2b34" ) {
            updateInterface("abort", { reason : "Wrong KLV, possible drift detected (stop)" });
            console.log("[debug] [readheader] drift detected")
            return
        }
        // Update interface : add KLV
        updateInterface("update", {
            "uuid" : uuid,
            "size" : ber.data_size,
            "offset" : offset,
            "fileSize" : file.size,
        });

        // Read Data from KLV
        readData(file, offset, ber.data_size);
        
        // Read the next KLV
        offset += ( 16 + ber.ber_size + ber.data_size );
        readHeader(file, offset);
    }

    function readHeader(fileHandler, offset) {
        let reader = new FileReader();
        let chunk = fileHandler.slice(offset, offset+24);  // read only 24 bytes
        reader.offset = offset;
        reader.onload = readHeaderHandler;
        reader.readAsArrayBuffer(chunk);
    }

    function readData(fileHandler, offset, size) {
        let reader = new FileReader();
        let chunk = fileHandler.slice(offset, offset + size);
        reader.offset = offset;
        reader.size = size;
        reader.onload = readDataHandler;
        reader.readAsArrayBuffer(chunk);
    }

    // Read the first KLV
    readHeader(file, 0);
}

function onDragOverHandler(event) {
    event.stopPropagation();
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
}

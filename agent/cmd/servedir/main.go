// servedir — yalnız deneme için: bir klasörü HTTP ile sunar (güncelleme
// akışını yerel bir "yayın sunucusu"yla sınamak). Yayın ikililerine girmez.
//
//	servedir 127.0.0.1:18080 /yol/klasör
package main

import (
	"log"
	"net/http"
	"os"
)

func main() {
	if len(os.Args) != 3 {
		log.Fatal("kullanım: servedir <adres> <klasör>")
	}
	log.Fatal(http.ListenAndServe(os.Args[1], http.FileServer(http.Dir(os.Args[2]))))
}
